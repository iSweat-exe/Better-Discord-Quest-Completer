//! Window, tray and background-task lifecycle.

use std::path::PathBuf;
use std::time::Duration;

use chrono::{Local, TimeZone};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Window, WindowEvent, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::discord::{self, DetectionRequest, DetectionState, SlowCause};
use crate::games::library::LibraryEntry;
use crate::games::model::Support;
use crate::launcher;
use crate::locale::Lang;
use crate::process::sessions::SessionInfo;
use crate::queue;
use crate::state::{
    EVENT_CLOSE_REQUESTED, EVENT_DETECTION_SLOW, EVENT_SESSION_COMPLETED, EVENT_SESSION_DETECTED, Shared,
};
use crate::util::{now_millis, spawn_blocking};

const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "main";
const SESSION_POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Discord's log is read every few polls, and only while a timer waits for it.
const DETECTION_POLL_EVERY: u32 = 4;
/// Reads of Discord's log that must fail in a row before a waiting timer gives
/// up and runs from the launch: one failed read (the log being rotated, a
/// passing lock) must not make the timer start too early.
const LOG_FAILURES_BEFORE_FALLBACK: u32 = 3;
/// The window starts hidden to avoid a white flash; this guarantees it is
/// eventually shown even if the frontend never gets to ask.
const SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(5);
/// Discord usually notices a game within a minute: past this, the user is told why it may not.
const SLOW_DETECTION_MS: i64 = 2 * 60_000;
/// While games run, the tray's remaining times and the resume point are refreshed this often (in polls).
const REFRESH_EVERY: u32 = 60;
/// Recent games offered in the tray menu.
const TRAY_RECENT_GAMES: usize = 5;
/// Lets the app settle (and Discord start, at login) before resuming games by itself.
const AUTO_RESUME_DELAY: Duration = Duration::from_secs(10);

/// Payload of [`EVENT_DETECTION_SLOW`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowDetection {
    pub session_id: String,
    pub game_name: String,
    pub cause: SlowCause,
}

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

/// Releases everything that must not outlive the app. The games it stops stay
/// resumable at the next start (see [`crate::resume`]).
pub fn shutdown(app: &AppHandle) {
    let state = app.state::<Shared>();
    state.begin_quit();
    state.save_resume_point();
    state.resume.freeze();
    let stopped = state.sessions.stop_all();
    state.finish_sessions(app, &stopped);
    state.presence.disconnect();
}

fn stop_all_sessions(app: &AppHandle) {
    let state = app.state::<Shared>();
    queue::forget(app);
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

/// What a running game's timer says in the tray: waiting, done, or the time left and when it ends.
fn timer_label(lang: Lang, session: &SessionInfo, now: i64) -> String {
    let Some(started) = session.timer_started_at() else { return lang.tray_waiting().to_owned() };
    let target_ms = i64::try_from(session.target_seconds.saturating_mul(1000)).unwrap_or(i64::MAX);
    let ends = started.saturating_add(target_ms);
    if ends <= now {
        return lang.tray_timer_done().to_owned();
    }
    let minutes = (ends - now).div_euclid(60_000) + 1;
    let at = Local.timestamp_millis_opt(ends).single().map(|time| time.format("%H:%M").to_string()).unwrap_or_default();
    lang.tray_remaining(minutes, &at)
}

/// The library's most recently played games that are not running and can be launched.
fn recent_games(entries: Vec<LibraryEntry>, running: &[SessionInfo]) -> Vec<LibraryEntry> {
    let mut recent: Vec<LibraryEntry> = entries
        .into_iter()
        .filter(|entry| entry.last_played_at.is_some())
        .filter(|entry| !running.iter().any(|session| session.game_id == entry.game.id))
        .filter(|entry| entry.game.executables.iter().any(|executable| executable.support == Support::Ok))
        .collect();
    recent.sort_by_key(|entry| std::cmp::Reverse(entry.last_played_at));
    recent.truncate(TRAY_RECENT_GAMES);
    recent
}

/// The tray menu reflects what runs: each game (click to stop it), the queue, recent games to relaunch.
fn tray_menu(app: &AppHandle, lang: Lang) -> tauri::Result<Menu<Wry>> {
    let state = app.state::<Shared>();
    let sessions = state.sessions.snapshot();
    let queue = state.queue.status();
    let now = now_millis();
    let separator = || PredefinedMenuItem::separator(app);
    let item = |id: String, label: &str, enabled: bool| MenuItem::with_id(app, id, label, enabled, None::<&str>);

    let menu = Menu::new(app)?;
    menu.append(&item("show".into(), lang.tray_show(), true)?)?;

    if !sessions.is_empty() {
        menu.append(&separator()?)?;
        for session in &sessions {
            let label = lang.tray_stop_game(&session.game_name, &timer_label(lang, session, now));
            menu.append(&item(format!("stop:{}", session.id), &label, true)?)?;
        }
        if sessions.len() > 1 {
            menu.append(&item("stop-all".into(), lang.tray_stop_all(), true)?)?;
        }
    }

    if queue.is_active() {
        menu.append(&separator()?)?;
        menu.append(&item("queue".into(), &lang.tray_queue(queue.playing.len(), queue.pending.len()), false)?)?;
        menu.append(&item("queue-stop".into(), lang.tray_queue_stop(), true)?)?;
    }

    let recent = recent_games(state.library.entries(), &sessions);
    if !recent.is_empty() {
        let submenu = Submenu::with_id(app, "recent", lang.tray_recent(), true)?;
        for entry in &recent {
            submenu.append(&item(format!("launch:{}", entry.game.id), &entry.game.name, true)?)?;
        }
        menu.append(&separator()?)?;
        menu.append(&submenu)?;
    }

    menu.append(&separator()?)?;
    menu.append(&item("quit".into(), lang.tray_quit(), true)?)?;
    Ok(menu)
}

/// Launches a game of the library from the tray, with the default timer.
fn launch_from_tray(app: &AppHandle, game_id: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<Shared>();
        let Some(entry) = state.library.entries().into_iter().find(|entry| entry.game.id == game_id) else { return };
        let Some(executable) = entry.game.executables.iter().find(|executable| executable.support == Support::Ok).cloned()
        else {
            return;
        };
        match launcher::start_session(&state, &game_id, &executable.name, None).await {
            Ok(_) => state.broadcast_sessions(&app),
            Err(error) => state.log.error(format!("Could not start {} from the tray: {error}", entry.game.name)),
        }
    });
}

fn stop_from_tray(app: &AppHandle, session_id: &str) {
    let state = app.state::<Shared>();
    if let Ok(stopped) = state.sessions.stop(session_id) {
        state.log.info(format!("{} stopped from the tray.", stopped.game_name));
        state.finish_sessions(app, std::slice::from_ref(&stopped));
        queue::sessions_ended(app, std::slice::from_ref(&stopped));
        state.broadcast_sessions(app);
    }
}

fn on_tray_menu(app: &AppHandle, id: &str) {
    match id {
        "show" => show_main_window(app),
        "stop-all" => stop_all_sessions(app),
        "queue-stop" => queue::clear(app),
        "quit" => quit(app),
        _ => {
            if let Some(session_id) = id.strip_prefix("stop:") {
                stop_from_tray(app, session_id);
            } else if let Some(game_id) = id.strip_prefix("launch:") {
                launch_from_tray(app, game_id.to_owned());
            }
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Discord Quest Completer")
        .menu(&tray_menu(app, current_lang(app))?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_tray_menu(app, event.id.as_ref()))
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

/// Rebuilds the tray menu and its tooltip: after a game started or stopped, the
/// queue moved, the language changed, or a minute passed.
pub fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let lang = current_lang(app);
    if let Ok(menu) = tray_menu(app, lang) {
        let _ = tray.set_menu(Some(menu));
    }
    let _ = tray.set_tooltip(Some(lang.tray_tooltip(app.state::<Shared>().sessions.count())));
}

/// Shows a system notification.
pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
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
        let mut log_failures = 0_u32;

        loop {
            ticker.tick().await;
            ticks = ticks.wrapping_add(1);
            let state = app.state::<Shared>();

            let detected =
                if ticks.is_multiple_of(DETECTION_POLL_EVERY) { poll_detection(&app, &mut log_failures).await } else { false };

            let reaped = state.sessions.reap();
            let mut changed = detected || !reaped.ended.is_empty();

            for session in &reaped.ended {
                state.log.info(format!("{} stopped (the process exited).", session.game_name));
            }
            state.finish_sessions(&app, &reaped.ended);
            queue::sessions_ended(&app, &reaped.ended);
            queue::check_timeout(&app);

            if ticks.is_multiple_of(DETECTION_POLL_EVERY) {
                warn_slow_detections(&app).await;
            }
            // The remaining times in the tray, and how far the timers went in case the app closes.
            if ticks.is_multiple_of(REFRESH_EVERY) && state.sessions.count() > 0 {
                state.save_resume_point();
                refresh_tray(&app);
            }

            for session in &reaped.completed {
                let minutes = session.target_seconds / 60;
                state.log.info(format!("{} reached the quest timer ({minutes} min).", session.game_name));
                let _ = app.emit(EVENT_SESSION_COMPLETED, session);

                let settings = state.settings.get();
                if settings.notify_on_complete && !main_window_focused(&app) {
                    let lang = Lang::resolve(settings.language);
                    notify(&app, lang.quest_notification_title(), &lang.quest_notification_body(&session.game_name, minutes));
                }

                // A game the queue plays waits for Discord to confirm its quest instead.
                if settings.auto_stop_on_complete
                    && !state.queue.is_current_session(&session.id)
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
/// Returns whether any session changed phase. `log_failures` counts the reads
/// of the log that failed in a row.
async fn poll_detection(app: &AppHandle, log_failures: &mut u32) -> bool {
    let state = app.state::<Shared>();
    let pending = state.sessions.pending_detection();
    if pending.is_empty() {
        *log_failures = 0;
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

    // The log is read once for every session: it is unavailable for all of them or for none.
    if reports.iter().any(|report| report.state == DetectionState::LogUnavailable) {
        *log_failures = log_failures.saturating_add(1);
        if *log_failures < LOG_FAILURES_BEFORE_FALLBACK {
            return false;
        }
    } else {
        *log_failures = 0;
    }

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
                    announce_detection(app, &session.id);
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

/// Tells the UI (and, if the window is not in view, the system) that Discord noticed a game.
fn announce_detection(app: &AppHandle, session_id: &str) {
    let state = app.state::<Shared>();
    let Some(session) = state.sessions.snapshot().into_iter().find(|session| session.id == session_id) else { return };
    let _ = app.emit(EVENT_SESSION_DETECTED, &session);

    let settings = state.settings.get();
    if settings.notify_on_detection && !main_window_focused(app) {
        let lang = Lang::resolve(settings.language);
        notify(app, lang.detected_title(), &lang.detected_body(&session.game_name));
    }
}

/// Warns once about each game Discord is slow to notice, with the likely reason.
async fn warn_slow_detections(app: &AppHandle) {
    let state = app.state::<Shared>();
    let slow = state.sessions.take_slow_detections(SLOW_DETECTION_MS, now_millis());
    if slow.is_empty() {
        return;
    }

    let games_dir = state.paths.games_dir();
    let Ok(cause) = spawn_blocking(move || discord::slow_detection_cause(&games_dir)).await else { return };
    let settings = state.settings.get();
    let lang = Lang::resolve(settings.language);

    for session in slow {
        state.log.warn(format!("Discord has not noticed {} after 2 minutes ({cause:?}).", session.game_name));
        let _ = app.emit(
            EVENT_DETECTION_SLOW,
            SlowDetection { session_id: session.id.clone(), game_name: session.game_name.clone(), cause: cause.clone() },
        );
        if settings.notify_on_detection && !main_window_focused(app) {
            notify(app, lang.slow_title(), &lang.slow_body(&session.game_name, &cause));
        }
    }
}

/// The in-app toast already covers a focused window.
pub fn main_window_focused(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW).is_some_and(|window| window.is_focused().unwrap_or(false))
}

/// With the setting on, resumes what a closed app left running, once the app has settled.
pub fn spawn_auto_resume(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(AUTO_RESUME_DELAY).await;
        let state = app.state::<Shared>();
        if state.settings.get().auto_resume && state.resume.interrupted().is_some() {
            let resumed = crate::resume::resume(&app).await;
            state.log.info(format!("Resumed automatically: {resumed} game(s) and quest(s)."));
        }
    });
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
