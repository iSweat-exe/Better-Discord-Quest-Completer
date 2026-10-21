//! Window, tray and background-task lifecycle.

use std::path::PathBuf;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::discord::{self, DetectionRequest, DetectionState};
use crate::locale::Lang;
use crate::state::{EVENT_CLOSE_REQUESTED, EVENT_SESSION_COMPLETED, Shared};
use crate::util::{now_millis, spawn_blocking};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "main";
const SESSION_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Discord's log is read every few polls, and only while a timer waits for it.
const DETECTION_POLL_EVERY: u32 = 4;
/// The window starts hidden to avoid a white flash; this guarantees it is
/// eventually shown even if the frontend never gets to ask.
const SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(5);

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}

/// Stops every fake game and leaves the application.
pub fn quit(app: &AppHandle) {
    shutdown(app);
    app.exit(0);
}

/// Releases everything that must not outlive the app.
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<Shared>();
    state.begin_quit();
    let stopped = state.sessions.stop_all();
    state.finish_sessions(app, &stopped);
    state.presence.disconnect();
}

fn stop_all_sessions(app: &AppHandle) {
    let state = app.state::<Shared>();
    let stopped = state.sessions.stop_all();
    for session in &stopped {
        state.log.info(format!("{} stopped from the tray.", session.game_name));
    }
    state.finish_sessions(app, &stopped);
    state.broadcast_sessions(app);
}

fn current_lang(app: &AppHandle) -> Lang {
    Lang::resolve(app.state::<Shared>().settings.get().language)
}

fn tray_menu(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(app, "show", lang.tray_show(), true, None::<&str>)?;
    let stop_all = MenuItem::with_id(app, "stop-all", lang.tray_stop_all(), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", lang.tray_quit(), true, None::<&str>)?;
    Menu::with_items(app, &[&show, &stop_all, &PredefinedMenuItem::separator(app)?, &quit])
}

/// Shows how many fake games are running when hovering the tray icon.
pub fn refresh_tray_tooltip(app: &AppHandle, running: usize) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let lang = current_lang(app);
    let _ = tray.set_tooltip(Some(lang.tray_tooltip(running)));
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Discord Quest Completer")
        .menu(&tray_menu(app, current_lang(app))?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "stop-all" => stop_all_sessions(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Rebuilds the tray menu, e.g. after the language changed.
pub fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok(menu) = tray_menu(app, current_lang(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };

    let app = window.app_handle();
    let state = app.state::<Shared>();
    if state.is_quitting() {
        return;
    }

    if state.settings.get().close_to_tray {
        api.prevent_close();
        let _ = window.hide();
        return;
    }

    let running = state.sessions.count();
    if running > 0 {
        // Closing would kill the fake games: let the user decide.
        api.prevent_close();
        let _ = app.emit(EVENT_CLOSE_REQUESTED, running);
    }
}

/// Polls the running sessions once per second: detects processes that exited
/// on their own, fires the quest-timer notification and, if asked, stops the
/// games whose timer completed.
pub fn spawn_session_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(SESSION_POLL_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut ticks = 0_u32;

        loop {
            ticker.tick().await;
            ticks = ticks.wrapping_add(1);
            let state = app.state::<Shared>();

            let detected = if ticks.is_multiple_of(DETECTION_POLL_EVERY) { poll_detection(&app).await } else { false };

            let reaped = state.sessions.reap();
            let mut changed = detected || !reaped.ended.is_empty();

            for session in &reaped.ended {
                state.log.info(format!("{} stopped (the process exited).", session.game_name));
            }
            state.finish_sessions(&app, &reaped.ended);

            for session in &reaped.completed {
                let minutes = session.target_seconds / 60;
                state.log.info(format!("{} reached the quest timer ({minutes} min).", session.game_name));
                let _ = app.emit(EVENT_SESSION_COMPLETED, session);

                let settings = state.settings.get();
                if settings.notify_on_complete && !main_window_focused(&app) {
                    let lang = Lang::resolve(settings.language);
                    let _ = app
                        .notification()
                        .builder()
                        .title(lang.quest_notification_title())
                        .body(lang.quest_notification_body(&session.game_name, minutes))
                        .show();
                }

                if settings.auto_stop_on_complete
                    && let Ok(stopped) = state.sessions.stop(&session.id)
                {
                    state.log.info(format!("{} stopped automatically.", stopped.game_name));
                    state.finish_sessions(&app, std::slice::from_ref(&stopped));
                    changed = true;
                }
            }

            if changed {
                state.broadcast_sessions(&app);
            }
        }
    });
}

/// Looks in Discord's log for the sessions whose timer waits for it.
/// Returns whether any session changed phase.
async fn poll_detection(app: &AppHandle) -> bool {
    let state = app.state::<Shared>();
    let pending = state.sessions.pending_detection();
    if pending.is_empty() {
        return false;
    }

    let requests: Vec<DetectionRequest> = pending
        .iter()
        .map(|session| DetectionRequest {
            game_id: session.game_id.clone(),
            exe_path: PathBuf::from(&session.path),
            started_at: session.started_at,
        })
        .collect();
    let Ok(reports) = spawn_blocking(move || discord::check_many(&requests)).await else { return false };

    let mut changed = false;
    for (session, report) in pending.iter().zip(reports) {
        match report.state {
            DetectionState::Detected => {
                let at = report.detected_at.unwrap_or_else(now_millis);
                if state.sessions.mark_detected(&session.id, at) {
                    let delay = (at - session.started_at).max(0) / 1000;
                    state.log.info(format!(
                        "{} noticed by Discord {delay} s after launch: the quest timer starts.",
                        session.game_name
                    ));
                    changed = true;
                }
            }
            DetectionState::LogUnavailable => {
                if state.sessions.mark_unverifiable(&session.id) {
                    state.log.warn(format!(
                        "Discord's log is unavailable: the timer of {} runs from the launch.",
                        session.game_name
                    ));
                    changed = true;
                }
            }
            DetectionState::Reacted | DetectionState::Waiting => {}
        }
    }
    changed
}

/// The in-app toast already covers a focused window.
pub fn main_window_focused(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW).is_some_and(|window| window.is_focused().unwrap_or(false))
}

pub fn spawn_show_fallback(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SHOW_FALLBACK_DELAY).await;
        if app.state::<Shared>().starts_hidden() {
            return;
        }
        if let Some(window) = app.get_webview_window(MAIN_WINDOW)
            && !window.is_visible().unwrap_or(true)
        {
            let _ = window.show();
        }
    });
}
