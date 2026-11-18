//! Resuming the fake games (and the quest queue) a closed app left behind.
//!
//! While games run, what they are and how far their timers went is saved to
//! `resume.json`. A clean stop of a game removes it from there; the app closing
//! (quit, crash, Windows restart, update) does not. At the next start, whatever
//! is left is moved to `resume-interrupted.json` and offered to the user, who
//! resumes it (each game with the time its timer still had) or dismisses it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::launcher;
use crate::process::sessions::SessionInfo;
use crate::queue::{self, QueueStatus};
use crate::settings::{MAX_QUEST_MINUTES, MIN_QUEST_MINUTES};
use crate::state::{EVENT_RESUME_CHANGED, Shared};
use crate::storage;

/// A fake game as it was when last saved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSession {
    pub game_id: String,
    pub game_name: String,
    pub executable: String,
    pub target_seconds: u64,
    /// How far its quest timer went (0 while it was still waiting for Discord).
    pub elapsed_seconds: u64,
}

impl SavedSession {
    pub fn from_session(session: &SessionInfo, now: i64) -> Self {
        let elapsed = session
            .timer_started_at()
            .map_or(0, |started| u64::try_from(now.saturating_sub(started) / 1000).unwrap_or(0));
        Self {
            game_id: session.game_id.clone(),
            game_name: session.game_name.clone(),
            executable: session.executable.clone(),
            target_seconds: session.target_seconds,
            elapsed_seconds: elapsed.min(session.target_seconds),
        }
    }

    /// The timer it still had, in whole minutes (at least one: Discord's own
    /// progress is what counts, and resuming is cheap).
    pub fn remaining_minutes(&self) -> u32 {
        let remaining = self.target_seconds.saturating_sub(self.elapsed_seconds).div_ceil(60);
        u32::try_from(remaining).unwrap_or(MAX_QUEST_MINUTES).clamp(MIN_QUEST_MINUTES, MAX_QUEST_MINUTES)
    }
}

/// What was running, and the queue, at a point in time.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ResumePoint {
    pub sessions: Vec<SavedSession>,
    pub queue: Option<QueueStatus>,
    /// Unix milliseconds.
    pub saved_at: i64,
}

impl ResumePoint {
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty() && !self.queue.as_ref().is_some_and(QueueStatus::is_active)
    }
}

/// What the UI shows about an interrupted run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptedRun {
    pub games: Vec<InterruptedGame>,
    /// Quests the queue still had to play (the one that was playing included).
    pub queued_quests: usize,
    /// Unix milliseconds.
    pub saved_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterruptedGame {
    pub game_id: String,
    pub game_name: String,
    pub remaining_minutes: u32,
}

pub struct ResumeStore {
    live_file: PathBuf,
    interrupted_file: PathBuf,
    interrupted: Mutex<Option<ResumePoint>>,
    /// Set while the app closes: the games it stops then must stay resumable.
    frozen: AtomicBool,
}

impl ResumeStore {
    /// Loads what the previous run left: a non-empty `resume.json` becomes the
    /// interrupted run (replacing an older one never dealt with).
    pub fn load(root: &Path) -> Self {
        let live_file = root.join("resume.json");
        let interrupted_file = root.join("resume-interrupted.json");

        let left: Option<ResumePoint> = storage::read_json(&live_file).ok().flatten().filter(|point: &ResumePoint| !point.is_empty());
        let interrupted = match left {
            Some(point) => {
                let _ = storage::write_json(&interrupted_file, &point);
                Some(point)
            }
            None => storage::read_json(&interrupted_file).ok().flatten().filter(|point: &ResumePoint| !point.is_empty()),
        };
        let _ = storage::write_json(&live_file, &ResumePoint::default());

        Self { live_file, interrupted_file, interrupted: Mutex::new(interrupted), frozen: AtomicBool::new(false) }
    }

    fn lock(&self) -> MutexGuard<'_, Option<ResumePoint>> {
        self.interrupted.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records what runs now. Ignored once the app is closing.
    pub fn save(&self, point: &ResumePoint) -> std::io::Result<()> {
        if self.frozen.load(Ordering::SeqCst) {
            return Ok(());
        }
        let bytes = serde_json::to_vec(point).map_err(std::io::Error::other)?;
        storage::write_atomic(&self.live_file, &bytes)
    }

    /// Keeps the last saved point as it is: the games stopped from now on (the
    /// app is closing or updating) are interrupted, not finished.
    pub fn freeze(&self) {
        self.frozen.store(true, Ordering::SeqCst);
    }

    pub fn interrupted(&self) -> Option<InterruptedRun> {
        self.lock().as_ref().map(summary)
    }

    /// Hands the interrupted run over (to resume it) and forgets it.
    pub fn take(&self) -> Option<ResumePoint> {
        let point = self.lock().take();
        let _ = std::fs::remove_file(&self.interrupted_file);
        point
    }

    pub fn dismiss(&self) {
        self.take();
    }
}

/// Restarts what the previous run left: its games, each with the time its timer
/// still had, and its queue. Returns how many games and quests were picked up.
pub async fn resume(app: &AppHandle) -> usize {
    let state = app.state::<Shared>();
    let Some(point) = state.resume.take() else { return 0 };
    let _ = app.emit(EVENT_RESUME_CHANGED, ());
    // Started in the tray, the catalog may not be loaded yet: the games are looked up in it.
    let _ = state.catalog.load_local().await;

    // The queue relaunches the games it was playing itself, each with the time it still had.
    let mut queue = point.queue.filter(QueueStatus::is_active);
    let mut queued_games = Vec::new();
    for playing in queue.iter_mut().flat_map(|queue| queue.playing.iter_mut()) {
        if let Some(saved) = point.sessions.iter().find(|session| session.game_id == playing.item.game_id) {
            playing.item.minutes = saved.remaining_minutes();
        }
        queued_games.push(playing.item.game_id.clone());
    }

    let mut resumed = 0;
    for saved in point.sessions.iter().filter(|saved| !queued_games.contains(&saved.game_id)) {
        match launcher::start_session(&state, &saved.game_id, &saved.executable, Some(saved.remaining_minutes())).await {
            Ok(_) => resumed += 1,
            Err(error) => state.log.warn(format!("Could not resume {}: {error}", saved.game_name)),
        }
    }
    if resumed > 0 {
        state.log.info(format!("{resumed} interrupted game(s) resumed."));
        state.broadcast_sessions(app);
    }

    if let Some(queue) = queue {
        let restored = state.queue.lock().restore(queue);
        if restored > 0 {
            state.log.info(format!("The quest queue resumed with {restored} quest(s)."));
            queue::changed(app);
            queue::kick(app);
        }
        resumed += restored;
    }
    resumed
}

/// Forgets what the previous run left.
pub fn dismiss(app: &AppHandle) {
    app.state::<Shared>().resume.dismiss();
    let _ = app.emit(EVENT_RESUME_CHANGED, ());
}

fn summary(point: &ResumePoint) -> InterruptedRun {
    let queued_quests = point.queue.as_ref().map_or(0, |queue| queue.playing.len() + queue.pending.len());
    InterruptedRun {
        games: point
            .sessions
            .iter()
            .map(|session| InterruptedGame {
                game_id: session.game_id.clone(),
                game_name: session.game_name.clone(),
                remaining_minutes: session.remaining_minutes(),
            })
            .collect(),
        queued_quests,
        saved_at: point.saved_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::sessions::DetectionPhase;
    use crate::queue::{QueueItem, QueueState};

    fn session(detection: DetectionPhase, started_at: i64, detected_at: Option<i64>) -> SessionInfo {
        SessionInfo {
            id: "1:game.exe".into(),
            game_id: "1".into(),
            game_name: "Game".into(),
            executable: "game.exe".into(),
            path: "x".into(),
            pid: 1,
            started_at,
            target_seconds: 900,
            detection,
            detected_at,
        }
    }

    fn point() -> ResumePoint {
        ResumePoint {
            sessions: vec![SavedSession::from_session(&session(DetectionPhase::Off, 0, None), 300_000)],
            queue: None,
            saved_at: 300_000,
        }
    }

    #[test]
    fn the_remaining_time_comes_from_the_timer() {
        let saved = SavedSession::from_session(&session(DetectionPhase::Off, 0, None), 300_000);
        assert_eq!(saved.elapsed_seconds, 300);
        assert_eq!(saved.remaining_minutes(), 10);

        let waiting = SavedSession::from_session(&session(DetectionPhase::Waiting, 0, None), 300_000);
        assert_eq!(waiting.remaining_minutes(), 15, "a timer that never started has all its time left");

        let done = SavedSession::from_session(&session(DetectionPhase::Off, 0, None), 10_000_000);
        assert_eq!(done.remaining_minutes(), MIN_QUEST_MINUTES);
    }

    #[test]
    fn what_was_running_at_the_last_save_is_offered_at_the_next_start() {
        let dir = tempfile::tempdir().unwrap();
        ResumeStore::load(dir.path()).save(&point()).unwrap();

        let next_run = ResumeStore::load(dir.path());
        let run = next_run.interrupted().expect("the games are offered");
        assert_eq!(run.games[0].remaining_minutes, 10);

        // Not dealt with: still offered after one more restart.
        assert!(ResumeStore::load(dir.path()).interrupted().is_some());
    }

    #[test]
    fn games_stopped_normally_are_not_offered() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResumeStore::load(dir.path());
        store.save(&point()).unwrap();
        store.save(&ResumePoint::default()).unwrap();
        assert!(ResumeStore::load(dir.path()).interrupted().is_none());
    }

    #[test]
    fn games_stopped_while_the_app_closes_stay_resumable() {
        let dir = tempfile::tempdir().unwrap();
        let store = ResumeStore::load(dir.path());
        store.save(&point()).unwrap();
        store.freeze();
        store.save(&ResumePoint::default()).unwrap();
        assert!(ResumeStore::load(dir.path()).interrupted().is_some());
    }

    #[test]
    fn a_resumed_or_dismissed_run_is_forgotten() {
        let dir = tempfile::tempdir().unwrap();
        ResumeStore::load(dir.path()).save(&point()).unwrap();

        let store = ResumeStore::load(dir.path());
        assert!(store.take().is_some());
        assert!(store.interrupted().is_none());
        assert!(ResumeStore::load(dir.path()).interrupted().is_none());
    }

    #[test]
    fn the_queue_counts_the_quest_that_was_playing() {
        let mut queue = QueueState::default();
        let item = |id: &str| QueueItem {
            quest_id: id.into(),
            quest_name: id.into(),
            game_id: "1".into(),
            game_name: "G".into(),
            executable: "g.exe".into(),
            minutes: 15,
        };
        queue.enqueue([item("a"), item("b")]);
        queue.next_to_start(0);

        let point = ResumePoint { sessions: Vec::new(), queue: Some(queue.status().clone()), saved_at: 1 };
        assert!(!point.is_empty());
        assert_eq!(summary(&point).queued_quests, 2);
    }
}
