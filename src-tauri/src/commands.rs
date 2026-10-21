//! Tauri commands: the whole surface the frontend can call.
//!
//! Commands stay thin; the logic lives in the domain modules.
//!
//! A plain `fn` command runs on the main thread, the one that also drives the
//! window: while it waits for the disk, the registry or a process, the whole UI
//! is frozen. Commands that do such work are therefore `#[tauri::command(async)]`
//! (or `async fn`), which runs them on the runtime's threads instead.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter as _, State};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::discord::{self, DetectionReport, DiscordStatus};
use crate::disk::{self, CleanReport, StorageInfo};
use crate::error::{AppError, AppResult};
use crate::games::catalog::Catalog;
use crate::games::library::LibraryEntry;
use crate::games::model::CURRENT_PLATFORM;
use crate::games::transfer;
use crate::launcher::{self, find_game};
use crate::lifecycle;
use crate::logger::LogEntry;
use crate::presence::{PresenceRequest, PresenceStatus};
use crate::process::runner;
use crate::process::sessions::SessionInfo;
use crate::quest_watch;
use crate::quests::QuestsResponse;
use crate::quests::model::Profile;
use crate::quests::risk::{ActivityEntry, RiskReport};
use crate::quests::shop::ShopResponse;
use crate::settings::{Settings, SettingsPatch};
use crate::state::{
    EVENT_CATALOG_UPDATED, EVENT_QUEST_VIDEO_ENDED, EVENT_QUEST_VIDEO_PROGRESS, EVENT_QUESTS_DISCONNECTED,
    EVENT_QUESTS_UPDATED, EVENT_UPDATE_PROGRESS, Shared,
};
use crate::updates::UpdateInfo;
use crate::stats::AppStats;
use crate::util::{now_millis, spawn_blocking};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: &'static str,
    pub platform: &'static str,
    pub runner_available: bool,
    pub data_dir: String,
}

#[tauri::command]
pub fn get_app_info(state: State<'_, Shared>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        platform: CURRENT_PLATFORM,
        runner_available: runner::is_available(),
        data_dir: state.paths.root().display().to_string(),
    }
}

// ---------------------------------------------------------------- catalog

/// Answers at once with what is stored locally, and refreshes from Discord in
/// the background (the result arrives as a `catalog-updated` event). Only an
/// explicit `refresh` waits for the download.
#[tauri::command]
pub async fn get_catalog(app: AppHandle, state: State<'_, Shared>, refresh: Option<bool>) -> AppResult<Arc<Catalog>> {
    let catalog = if refresh.unwrap_or(false) {
        let loaded = state.catalog.load(true).await;
        logged(&state, "Could not load the game list", loaded)?
    } else {
        let local = state.catalog.load_local().await;
        let (catalog, refresh_due) = logged(&state, "Could not load the game list", local)?;
        if refresh_due {
            refresh_catalog_in_background(&app, &state);
        }
        catalog
    };

    // Keep the saved games in sync with the freshest data.
    if state.library.sync_with(&catalog.games)? {
        state.log.info("Saved games updated from the game list.");
    }
    Ok(catalog)
}

/// Downloads the game list without making anyone wait for it.
fn refresh_catalog_in_background(app: &AppHandle, state: &Shared) {
    if !state.catalog.begin_background_refresh() {
        return;
    }

    let app = app.clone();
    let shared = Arc::clone(state);
    tauri::async_runtime::spawn(async move {
        let loaded = shared.catalog.load(true).await;
        shared.catalog.end_background_refresh();

        match loaded {
            Ok(catalog) => {
                if let Err(error) = shared.library.sync_with(&catalog.games) {
                    shared.log.warn(format!("Could not update the saved games: {error}"));
                }
                let _ = app.emit(EVENT_CATALOG_UPDATED, catalog);
            }
            Err(error) => shared.log.error(format!("Could not refresh the game list: {error}")),
        }
    });
}

// ---------------------------------------------------------------- library

#[tauri::command]
pub fn get_library(state: State<'_, Shared>) -> Vec<LibraryEntry> {
    state.library.entries()
}

#[tauri::command(async)]
pub fn add_to_library(state: State<'_, Shared>, game_id: String) -> AppResult<Vec<LibraryEntry>> {
    let game = find_game(&state, &game_id)?;
    state.log.info(format!("{} added to the library.", game.name));
    state.library.add(game)
}

#[tauri::command]
pub async fn remove_from_library(state: State<'_, Shared>, game_id: String) -> AppResult<Vec<LibraryEntry>> {
    if state.sessions.is_game_running(&game_id) {
        let name = state.library.get(&game_id).map_or_else(|| game_id.clone(), |game| game.name);
        return Err(AppError::GameRunning(name));
    }

    let entries = state.library.remove(&game_id)?;

    // The fake executables of a game nobody plays anymore are just clutter.
    let games_dir = state.paths.games_dir();
    spawn_blocking(move || disk::remove_game_folder(&games_dir, &game_id)).await?;
    Ok(entries)
}

#[tauri::command(async)]
pub fn export_library(state: State<'_, Shared>) -> AppResult<String> {
    transfer::export(&state.library.entries())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub added: usize,
    pub already_present: usize,
    /// Ids that are not in the current game list.
    pub unknown: usize,
}

#[tauri::command]
pub async fn import_library(state: State<'_, Shared>, json: String) -> AppResult<ImportReport> {
    let ids = transfer::parse(&json)?;
    // Imported ids are resolved against the catalog, which therefore must be loaded.
    state.catalog.load(false).await?;

    let mut report = ImportReport { added: 0, already_present: 0, unknown: 0 };
    for id in ids {
        if state.library.get(&id).is_some() {
            report.already_present += 1;
        } else if let Some(game) = state.catalog.find(&id) {
            state.library.add(game)?;
            report.added += 1;
        } else {
            report.unknown += 1;
        }
    }

    state.log.info(format!("Library import: {} added, {} unknown.", report.added, report.unknown));
    Ok(report)
}

// --------------------------------------------------------------- settings

#[tauri::command]
pub fn get_settings(state: State<'_, Shared>) -> Settings {
    state.settings.get()
}

#[tauri::command(async)]
pub fn update_settings(app: AppHandle, state: State<'_, Shared>, patch: SettingsPatch) -> AppResult<Settings> {
    // The system entry is changed first: if Windows refuses, nothing is saved.
    if let Some(enabled) = patch.launch_at_startup
        && enabled != state.settings.get().launch_at_startup
    {
        let autolaunch = app.autolaunch();
        let result = if enabled { autolaunch.enable() } else { autolaunch.disable() };
        result.map_err(|error| AppError::Internal(format!("could not change the startup entry: {error}")))?;
    }

    let settings = state.settings.update(patch)?;
    lifecycle::refresh_tray(&app);
    Ok(settings)
}

// --------------------------------------------------------------- sessions

#[tauri::command]
pub fn list_sessions(state: State<'_, Shared>) -> Vec<SessionInfo> {
    state.sessions.snapshot()
}

#[tauri::command]
pub async fn start_session(
    app: AppHandle,
    state: State<'_, Shared>,
    game_id: String,
    executable: String,
    target_minutes: Option<u32>,
) -> AppResult<SessionInfo> {
    let started = launcher::start_session(&state, &game_id, &executable, target_minutes).await;
    let session = logged(&state, "Could not start the game", started)?;
    state.broadcast_sessions(&app);
    Ok(session)
}

#[tauri::command(async)]
pub fn stop_session(app: AppHandle, state: State<'_, Shared>, session_id: String) -> AppResult<()> {
    let session = state.sessions.stop(&session_id)?;
    state.log.info(format!("{} stopped.", session.game_name));
    state.finish_sessions(&app, std::slice::from_ref(&session));
    state.broadcast_sessions(&app);
    Ok(())
}

#[tauri::command(async)]
pub fn stop_all_sessions(app: AppHandle, state: State<'_, Shared>) {
    let stopped = state.sessions.stop_all();
    if !stopped.is_empty() {
        state.log.info(format!("{} session(s) stopped.", stopped.len()));
        state.finish_sessions(&app, &stopped);
        state.broadcast_sessions(&app);
    }
}

// ------------------------------------------------------- discord quests
//
// Quests are listed behind the user's account, so these commands deal with the
// user's token. It enters through `connect_quests` only, is stored in the
// system credential store and is never sent back to the frontend.

#[tauri::command]
pub async fn get_quests_connection(state: State<'_, Shared>) -> AppResult<bool> {
    state.quests.is_connected().await
}

#[tauri::command]
pub async fn connect_quests(app: AppHandle, state: State<'_, Shared>, token: String) -> AppResult<QuestsResponse> {
    let connected = state.quests.connect(&token).await;
    let sync = logged(&state, "Could not connect to Discord quests", connected)?;
    quest_watch::apply(&app, sync.changes);
    Ok(sync.response)
}

/// The quests as last seen, available before any request.
#[tauri::command]
pub async fn get_cached_quests(state: State<'_, Shared>) -> AppResult<Option<QuestsResponse>> {
    state.quests.cached_quests().await
}

#[tauri::command]
pub async fn refresh_quests(app: AppHandle, state: State<'_, Shared>) -> AppResult<QuestsResponse> {
    let refreshed = state.quests.refresh().await;
    let sync = logged(&state, "Could not load Discord quests", refreshed)?;
    quest_watch::apply(&app, sync.changes);
    Ok(sync.response)
}

/// Accepts a quest on the account. Only ever called from a click on that quest.
#[tauri::command]
pub async fn enroll_quest(app: AppHandle, state: State<'_, Shared>, quest_id: String) -> AppResult<QuestsResponse> {
    let done = state.quests.enroll(&quest_id).await;
    let sync = logged(&state, "Could not accept the quest", done)?;
    quest_watch::apply(&app, sync.changes);
    Ok(sync.response)
}

/// Claims the reward of a completed quest.
#[tauri::command]
pub async fn claim_quest_reward(app: AppHandle, state: State<'_, Shared>, quest_id: String) -> AppResult<QuestsResponse> {
    let done = state.quests.claim_reward(&quest_id).await;
    let sync = logged(&state, "Could not claim the quest reward", done)?;
    quest_watch::apply(&app, sync.changes);
    Ok(sync.response)
}

/// Payload of [`EVENT_QUEST_VIDEO_PROGRESS`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProgress {
    pub quest_id: String,
    pub seconds: u64,
    pub target: u64,
}

/// Payload of [`EVENT_QUEST_VIDEO_ENDED`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEnded {
    pub quest_id: String,
    pub name: String,
    pub ok: bool,
    pub message: Option<String>,
}

/// Starts watching the video of an accepted quest, one reported second per second: as long as the video itself.
/// The viewing goes on in the background, whatever the user does in the app; its end is an event.
#[tauri::command]
pub async fn watch_quest_video(app: AppHandle, state: State<'_, Shared>, quest_id: String) -> AppResult<()> {
    if !state.quests.begin_video(&quest_id) {
        return Ok(());
    }
    let shared = Arc::clone(state.inner());
    tauri::async_runtime::spawn(async move { run_video(app, shared, quest_id).await });
    Ok(())
}

async fn run_video(app: AppHandle, state: Shared, quest_id: String) {
    let name = state.quests.quest_name(&quest_id);
    let result = state
        .quests
        .watch_video(&quest_id, |seconds, target| {
            state.quests.set_video_progress(&quest_id, seconds, target);
            let _ = app.emit(
                EVENT_QUEST_VIDEO_PROGRESS,
                VideoProgress { quest_id: quest_id.clone(), seconds, target },
            );
        })
        .await;
    state.quests.end_video(&quest_id);

    let ended = match result {
        Ok(sync) => {
            quest_watch::credit_video(&app, &sync.response.quests, &quest_id);
            quest_watch::apply(&app, sync.changes);
            let _ = app.emit(EVENT_QUESTS_UPDATED, sync.response);
            VideoEnded { quest_id, name, ok: true, message: None }
        }
        Err(error) => {
            state.log.error(format!("Could not complete the quest video: {error}"));
            if matches!(error, AppError::TokenInvalid) {
                let _ = app.emit(EVENT_QUESTS_DISCONNECTED, ());
            }
            VideoEnded { quest_id, name, ok: false, message: Some(error.to_string()) }
        }
    };
    let _ = app.emit(EVENT_QUEST_VIDEO_ENDED, ended);
}

/// The videos being watched now, so the UI can pick them up after a reload.
#[tauri::command]
pub fn get_active_videos(state: State<'_, Shared>) -> Vec<VideoProgress> {
    state
        .quests
        .active_videos()
        .into_iter()
        .map(|(quest_id, seconds, target)| VideoProgress { quest_id, seconds, target })
        .collect()
}

/// The videos that were being watched when the app was closed.
#[tauri::command]
pub fn get_interrupted_videos(state: State<'_, Shared>) -> Vec<String> {
    state.quests.interrupted_videos()
}

/// The user does not want to resume the interrupted videos.
#[tauri::command]
pub fn dismiss_interrupted_videos(state: State<'_, Shared>) {
    state.quests.dismiss_interrupted_videos();
}

/// The writes made on the account, newest first.
#[tauri::command]
pub fn get_quest_activity(state: State<'_, Shared>) -> Vec<ActivityEntry> {
    state.quests.activity()
}

/// How suspicious the recent writes on the account look (see `quests::risk`).
#[tauri::command]
pub fn get_quest_risk(state: State<'_, Shared>) -> RiskReport {
    state.quests.risk()
}

/// What the app itself helped complete (the account's own totals come from the quests).
#[tauri::command]
pub fn get_app_stats(state: State<'_, Shared>) -> AppStats {
    state.stats.summary(now_millis())
}

/// Who the saved token belongs to. Only the public identity is returned.
#[tauri::command]
pub async fn get_profile(state: State<'_, Shared>) -> AppResult<Profile> {
    state.quests.profile().await
}

/// The Orbs balance is a nicety: its failures stay out of the activity log.
#[tauri::command]
pub async fn get_orbs_balance(state: State<'_, Shared>) -> AppResult<u64> {
    state.quests.orbs_balance().await
}

/// What the Orbs shop sells. Like the balance, a nicety: failures stay out of the log.
#[tauri::command]
pub async fn get_orbs_shop(state: State<'_, Shared>) -> AppResult<ShopResponse> {
    state.quests.orbs_shop().await
}

#[tauri::command]
pub async fn disconnect_quests(state: State<'_, Shared>) -> AppResult<()> {
    state.quests.disconnect().await
}

// ---------------------------------------------------------------- updates

/// Looks for a newer version now. `None` means the app is up to date.
#[tauri::command]
pub async fn check_for_update(app: AppHandle, state: State<'_, Shared>) -> AppResult<Option<UpdateInfo>> {
    let checked = state.updates.check(&app).await;
    logged(&state, "Could not check for updates", checked)
}

/// The update found by the last check, so the UI can show it after a reload.
#[tauri::command]
pub fn get_pending_update(state: State<'_, Shared>) -> Option<UpdateInfo> {
    state.updates.pending_info()
}

/// Installs the pending update and restarts the app. The fake games are stopped
/// first: the installer replaces the program they were started by.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, Shared>) -> AppResult<()> {
    let stopped = state.sessions.stop_all();
    state.finish_sessions(&app, &stopped);
    state.broadcast_sessions(&app);

    state.log.info("Downloading the update…");
    let progress_app = app.clone();
    let installed = state
        .updates
        .install(move |progress| {
            let _ = progress_app.emit(EVENT_UPDATE_PROGRESS, progress);
        })
        .await;
    logged(&state, "Could not install the update", installed)?;

    // Reached where the installer does not quit the app by itself.
    lifecycle::shutdown(&app);
    app.restart()
}

// -------------------------------------------------------------- diagnosis

#[tauri::command]
pub async fn get_discord_status() -> AppResult<DiscordStatus> {
    spawn_blocking(discord::status).await
}

/// Asks Discord's own log whether it noticed the game of `session_id`.
#[tauri::command]
pub async fn check_detection(state: State<'_, Shared>, session_id: String) -> AppResult<DetectionReport> {
    let session = state
        .sessions
        .snapshot()
        .into_iter()
        .find(|session| session.id == session_id)
        .ok_or(AppError::SessionNotFound(session_id))?;

    let path = PathBuf::from(&session.path);
    let report = spawn_blocking(move || discord::check_detection(&session.game_id, &path, session.started_at)).await?;
    state.log.info(format!("Detection check for {}: {:?}.", session.game_name, report.state));
    Ok(report)
}

/// Opens the file manager on a game's fake executable.
#[tauri::command(async)]
pub fn reveal_executable(
    app: AppHandle,
    state: State<'_, Shared>,
    game_id: String,
    executable: String,
) -> AppResult<()> {
    let game = find_game(&state, &game_id)?;
    let (_, program) = launcher::executable_location(&state, &game, &executable)?;

    // A game that never ran has no file yet: show its folder instead.
    let target = if program.exists() { program } else { state.paths.games_dir() };
    std::fs::create_dir_all(state.paths.games_dir()).map_err(AppError::io("creating the games folder"))?;

    app.opener()
        .reveal_item_in_dir(&target)
        .map_err(|error| AppError::Internal(format!("could not open the folder: {error}")))
}

// ---------------------------------------------------------------- storage

#[tauri::command]
pub async fn get_storage_info(state: State<'_, Shared>) -> AppResult<StorageInfo> {
    let games_dir = state.paths.games_dir();
    spawn_blocking(move || disk::inspect(&games_dir)).await
}

#[tauri::command]
pub async fn clean_storage(state: State<'_, Shared>) -> AppResult<CleanReport> {
    let games_dir = state.paths.games_dir();
    let running: HashSet<String> = state.sessions.snapshot().into_iter().map(|session| session.game_id).collect();

    let report = spawn_blocking(move || disk::clean(&games_dir, &running)).await?;
    state.log.info(format!("Cleanup: {} game folder(s) removed.", report.removed_games));
    Ok(report)
}

#[tauri::command(async)]
pub fn open_games_folder(app: AppHandle, state: State<'_, Shared>) -> AppResult<()> {
    let folder = state.paths.games_dir();
    std::fs::create_dir_all(&folder).map_err(AppError::io("creating the games folder"))?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|error| AppError::Internal(format!("could not open the folder: {error}")))
}

// ------------------------------------------------------------------- logs

#[tauri::command]
pub fn get_logs(state: State<'_, Shared>) -> Vec<LogEntry> {
    state.log.snapshot()
}

#[tauri::command]
pub fn clear_logs(state: State<'_, Shared>) {
    state.log.clear();
}

// --------------------------------------------------------------- presence

#[tauri::command]
pub fn get_presence_status(state: State<'_, Shared>) -> PresenceStatus {
    state.presence.status()
}

#[tauri::command]
pub async fn publish_presence(state: State<'_, Shared>, request: PresenceRequest) -> AppResult<PresenceStatus> {
    let game = find_game(&state, &request.game_id)?;

    let shared = Arc::clone(&state);
    let published = spawn_blocking(move || shared.presence.publish(&game, &request)).await?;
    let status = logged(&state, "Rich Presence failed", published)?;

    if let Some(name) = &status.game_name {
        state.log.info(format!("Rich Presence published for {name}."));
    }
    Ok(status)
}

#[tauri::command]
pub async fn clear_presence(state: State<'_, Shared>) -> AppResult<PresenceStatus> {
    let shared = Arc::clone(&state);
    let status = spawn_blocking(move || shared.presence.disconnect()).await?;
    state.log.info("Rich Presence cleared.");
    Ok(status)
}

// ----------------------------------------------------------------- window

/// The frontend has rendered: show the window, unless the app was started
/// minimized to the tray.
#[tauri::command]
pub fn window_ready(app: AppHandle, state: State<'_, Shared>) {
    if !state.starts_hidden() {
        lifecycle::show_main_window(&app);
    }
}

#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    lifecycle::hide_main_window(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    lifecycle::quit(&app);
}

// ---------------------------------------------------------------- helpers

/// Records a failed command in the activity log before handing the error back.
fn logged<T>(state: &Shared, context: &str, result: AppResult<T>) -> AppResult<T> {
    if let Err(error) = &result {
        state.log.error(format!("{context}: {error}"));
    }
    result
}
