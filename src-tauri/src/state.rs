//! Shared application state, managed by Tauri.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

use crate::error::{AppError, AppResult};
use crate::games::catalog::CatalogService;
use crate::games::library::Library;
use crate::lifecycle;
use crate::logger::AppLog;
use crate::paths::AppPaths;
use crate::presence::PresenceManager;
use crate::process::sessions::{SessionInfo, SessionManager};
use crate::quests::QuestService;
use crate::settings::SettingsStore;
use crate::stats::StatsStore;
use crate::updates::UpdateService;
use crate::util::now_millis;

pub const EVENT_SESSIONS_CHANGED: &str = "sessions-changed";
pub const EVENT_SESSION_COMPLETED: &str = "session-completed";
pub const EVENT_CLOSE_REQUESTED: &str = "close-requested";
pub const EVENT_LIBRARY_CHANGED: &str = "library-changed";
/// Carries a fresh `QuestsResponse`, so the quest list updates by itself.
/// Carries the game list downloaded in the background.
pub const EVENT_CATALOG_UPDATED: &str = "catalog-updated";
/// A newer version was found (payload: [`crate::updates::UpdateInfo`]).
pub const EVENT_UPDATE_AVAILABLE: &str = "update-available";
/// Progress of the download of an update (payload: [`crate::updates::DownloadProgress`]).
pub const EVENT_UPDATE_PROGRESS: &str = "update-progress";
/// The totals of what the app completed changed.
pub const EVENT_STATS_CHANGED: &str = "stats-changed";
pub const EVENT_QUESTS_UPDATED: &str = "quests-updated";
/// Discord rejected the saved token while no one was looking.
pub const EVENT_QUESTS_DISCONNECTED: &str = "quests-disconnected";
/// Discord itself marked a quest as completed (payload: [`crate::quest_watch::QuestDone`]).
pub const EVENT_QUEST_DONE: &str = "quest-done";
/// A second more of a video quest was reported (payload: [`crate::commands::VideoProgress`]).
pub const EVENT_QUEST_VIDEO_PROGRESS: &str = "quest-video-progress";
/// The app stopped watching a video, done or not (payload: [`crate::commands::VideoEnded`]).
pub const EVENT_QUEST_VIDEO_ENDED: &str = "quest-video-ended";

/// Argument passed by the "launch at startup" entry: start in the tray.
pub const MINIMIZED_ARGUMENT: &str = "--minimized";

/// How the state is registered with Tauri, so background tasks can own a handle.
pub type Shared = Arc<AppState>;

pub struct AppState {
    pub paths: AppPaths,
    pub settings: SettingsStore,
    pub library: Library,
    pub catalog: CatalogService,
    pub sessions: SessionManager,
    pub presence: PresenceManager,
    pub quests: QuestService,
    pub stats: StatsStore,
    pub updates: UpdateService,
    pub log: Arc<AppLog>,
    /// The app was started with `--minimized`: the window stays hidden.
    start_hidden: bool,
    quitting: AtomicBool,
}

impl AppState {
    pub fn init(app: &AppHandle) -> AppResult<Self> {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| AppError::Internal(format!("no data folder available: {error}")))?;
        let paths = AppPaths::new(root);

        let log = Arc::new(AppLog::default());
        log.attach(app.clone());

        Ok(Self {
            settings: SettingsStore::load(paths.settings_file())?,
            library: Library::load(paths.library_file())?,
            catalog: CatalogService::new(paths.catalog_cache_file(), Arc::clone(&log))?,
            sessions: SessionManager::new(Arc::clone(&log)),
            presence: PresenceManager::default(),
            quests: QuestService::new(Arc::clone(&log), paths.quests_seen_file(), paths.quests_cache_file())?,
            stats: StatsStore::load(paths.stats_file())?,
            updates: UpdateService::default(),
            log,
            paths,
            start_hidden: std::env::args().any(|argument| argument == MINIMIZED_ARGUMENT),
            quitting: AtomicBool::new(false),
        })
    }

    pub fn starts_hidden(&self) -> bool {
        self.start_hidden
    }

    /// Tells the frontend the list of running sessions changed.
    pub fn broadcast_sessions(&self, app: &AppHandle) {
        let sessions = self.sessions.snapshot();
        lifecycle::refresh_tray_tooltip(app, sessions.len());
        let _ = app.emit(EVENT_SESSIONS_CHANGED, sessions);
    }

    /// Books sessions that just ended: playtime goes to the library.
    pub fn finish_sessions(&self, app: &AppHandle, ended: &[SessionInfo]) {
        if ended.is_empty() {
            return;
        }

        let now = now_millis();
        for session in ended {
            if let Err(error) = self.library.record_session(&session.game_id, session.started_at, now) {
                self.log.warn(format!("Could not save the playtime of {}: {error}", session.game_name));
            }
        }
        let _ = app.emit(EVENT_LIBRARY_CHANGED, ());
    }

    pub fn begin_quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }
}
