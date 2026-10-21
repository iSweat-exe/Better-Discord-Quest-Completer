//! Running fake games.
//!
//! Every session owns its child process, so stopping one only ever terminates
//! the process this app started (never another program that happens to share
//! the same executable name).

use std::collections::HashMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;

use super::job::ProcessJob;
use crate::error::{AppError, AppResult};
use crate::logger::AppLog;
use crate::util::now_millis;

/// Where a session stands with respect to Discord noticing the game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectionPhase {
    /// The user chose not to wait: the timer runs from the launch.
    Off,
    /// Waiting for Discord to notice the game: the timer has not started.
    Waiting,
    /// Discord noticed the game: the timer runs from `detected_at`.
    Detected,
    /// Discord's log cannot be read, so detection cannot be confirmed: the
    /// timer runs from the launch rather than never.
    Unverifiable,
}

#[derive(Debug)]
pub struct LaunchSpec {
    pub id: String,
    pub game_id: String,
    pub game_name: String,
    pub executable: String,
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub working_dir: PathBuf,
    /// Playtime after which the quest timer is complete.
    pub target: Duration,
    /// Hold the timer back until Discord has noticed the game.
    pub await_detection: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub game_id: String,
    pub game_name: String,
    pub executable: String,
    /// Full path of the fake executable that is running.
    pub path: String,
    pub pid: u32,
    /// Unix timestamp in milliseconds.
    pub started_at: i64,
    pub target_seconds: u64,
    pub detection: DetectionPhase,
    /// Unix milliseconds of the first sign that Discord noticed the game.
    pub detected_at: Option<i64>,
}

impl SessionInfo {
    /// When the quest timer started, or `None` while it still waits for Discord.
    pub fn timer_started_at(&self) -> Option<i64> {
        match self.detection {
            DetectionPhase::Waiting => None,
            DetectionPhase::Detected => self.detected_at,
            DetectionPhase::Off | DetectionPhase::Unverifiable => Some(self.started_at),
        }
    }
}

struct ActiveSession {
    info: SessionInfo,
    child: Child,
    completion_reported: bool,
}

/// What changed since the previous call to [`SessionManager::reap`].
#[derive(Debug, Default)]
pub struct Reaped {
    /// Sessions whose process is gone (closed by the user, crashed, killed…).
    pub ended: Vec<SessionInfo>,
    /// Sessions that just reached their target duration.
    pub completed: Vec<SessionInfo>,
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, ActiveSession>>,
    job: Option<ProcessJob>,
    log: Arc<AppLog>,
}

impl SessionManager {
    pub fn new(log: Arc<AppLog>) -> Self {
        let job = ProcessJob::new()
            .inspect_err(|error| log.warn(format!("Fake games will not be cleaned up automatically on crash: {error}")))
            .ok();

        Self { sessions: Mutex::new(HashMap::new()), job, log }
    }

    pub fn start(&self, spec: LaunchSpec) -> AppResult<SessionInfo> {
        let mut sessions = self.lock();
        if sessions.contains_key(&spec.id) {
            return Err(AppError::AlreadyRunning(spec.game_name));
        }

        let child = Command::new(&spec.program)
            .args(&spec.args)
            .current_dir(&spec.working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(AppError::io("starting the fake game"))?;

        if let Some(job) = &self.job
            && let Err(error) = job.assign(&child)
        {
            self.log.warn(format!("Could not attach {} to the process job: {error}", spec.game_name));
        }

        let info = SessionInfo {
            id: spec.id.clone(),
            game_id: spec.game_id,
            game_name: spec.game_name,
            executable: spec.executable,
            path: spec.program.display().to_string(),
            pid: child.id(),
            started_at: now_millis(),
            target_seconds: spec.target.as_secs(),
            detection: if spec.await_detection { DetectionPhase::Waiting } else { DetectionPhase::Off },
            detected_at: None,
        };

        sessions.insert(spec.id, ActiveSession { info: info.clone(), child, completion_reported: false });
        Ok(info)
    }

    pub fn stop(&self, id: &str) -> AppResult<SessionInfo> {
        let session = self.lock().remove(id).ok_or_else(|| AppError::SessionNotFound(id.to_owned()))?;
        Ok(terminate(session))
    }

    /// Stops every session; returns the stopped ones.
    pub fn stop_all(&self) -> Vec<SessionInfo> {
        let stopped: Vec<ActiveSession> = self.lock().drain().map(|(_, session)| session).collect();

        // Terminate outside the lock: waiting on a process must not block others.
        stopped.into_iter().map(terminate).collect()
    }

    pub fn snapshot(&self) -> Vec<SessionInfo> {
        let mut sessions: Vec<SessionInfo> = self.lock().values().map(|session| session.info.clone()).collect();
        sessions.sort_by(|a, b| a.started_at.cmp(&b.started_at).then_with(|| a.id.cmp(&b.id)));
        sessions
    }

    /// Sessions whose timer still waits for Discord.
    pub fn pending_detection(&self) -> Vec<SessionInfo> {
        self.lock()
            .values()
            .filter(|session| session.info.detection == DetectionPhase::Waiting)
            .map(|session| session.info.clone())
            .collect()
    }

    /// Starts the timer of a waiting session. Returns whether anything changed.
    pub fn mark_detected(&self, id: &str, at: i64) -> bool {
        self.transition(id, |info| {
            info.detection = DetectionPhase::Detected;
            // Evidence can never predate the launch.
            info.detected_at = Some(at.max(info.started_at));
        })
    }

    /// Falls back to a launch-time timer when detection cannot be verified.
    pub fn mark_unverifiable(&self, id: &str) -> bool {
        self.transition(id, |info| info.detection = DetectionPhase::Unverifiable)
    }

    fn transition(&self, id: &str, apply: impl FnOnce(&mut SessionInfo)) -> bool {
        let mut sessions = self.lock();
        match sessions.get_mut(id) {
            Some(session) if session.info.detection == DetectionPhase::Waiting => {
                apply(&mut session.info);
                true
            }
            _ => false,
        }
    }

    pub fn is_game_running(&self, game_id: &str) -> bool {
        self.lock().values().any(|session| session.info.game_id == game_id)
    }

    pub fn count(&self) -> usize {
        self.lock().len()
    }

    /// Detects processes that exited on their own and sessions that reached
    /// their target duration. Meant to be polled about once per second.
    pub fn reap(&self) -> Reaped {
        let now = now_millis();
        let mut reaped = Reaped::default();
        let mut sessions = self.lock();

        let mut gone = Vec::new();
        for (id, session) in sessions.iter_mut() {
            match session.child.try_wait() {
                Ok(None) => {
                    let target_ms = i64::try_from(session.info.target_seconds.saturating_mul(1000)).unwrap_or(i64::MAX);
                    let reached = session
                        .info
                        .timer_started_at()
                        .is_some_and(|started| now.saturating_sub(started) >= target_ms);
                    if !session.completion_reported && reached {
                        session.completion_reported = true;
                        reaped.completed.push(session.info.clone());
                    }
                }
                // Exited, or impossible to query anymore: either way, it is over.
                Ok(Some(_)) | Err(_) => gone.push(id.clone()),
            }
        }

        for id in gone {
            if let Some(session) = sessions.remove(&id) {
                reaped.ended.push(session.info);
            }
        }
        reaped
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, ActiveSession>> {
        self.sessions.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn terminate(mut session: ActiveSession) -> SessionInfo {
    // Errors mean the process already exited, which is the desired outcome.
    let _ = session.child.kill();
    let _ = session.child.wait();
    session.info
}

#[cfg(all(test, windows))]
mod tests {
    use std::time::Instant;

    use super::*;

    fn manager() -> SessionManager {
        SessionManager::new(Arc::new(AppLog::default()))
    }

    /// A harmless process that lives long enough for the tests.
    fn long_running(id: &str, target: Duration) -> LaunchSpec {
        LaunchSpec {
            id: id.into(),
            game_id: "1".into(),
            game_name: "Test game".into(),
            executable: "ping.exe".into(),
            program: "ping".into(),
            args: ["-n", "60", "127.0.0.1"].map(OsString::from).into(),
            working_dir: std::env::temp_dir(),
            target,
            await_detection: false,
        }
    }

    #[test]
    fn started_sessions_are_listed_then_stopped() {
        let manager = manager();
        let info = manager.start(long_running("a", Duration::from_mins(15))).unwrap();

        assert!(info.pid > 0);
        assert_eq!(manager.snapshot(), [info]);
        assert!(manager.is_game_running("1"));

        manager.stop("a").unwrap();
        assert_eq!(manager.count(), 0);
        assert!(!manager.is_game_running("1"));
    }

    #[test]
    fn the_same_session_cannot_start_twice() {
        let manager = manager();
        manager.start(long_running("a", Duration::from_mins(15))).unwrap();

        let error = manager.start(long_running("a", Duration::from_mins(15))).unwrap_err();
        assert_eq!(error.kind(), "alreadyRunning");

        manager.stop_all();
    }

    #[test]
    fn stopping_an_unknown_session_fails() {
        assert_eq!(manager().stop("nope").unwrap_err().kind(), "sessionNotFound");
    }

    #[test]
    fn starting_a_missing_program_fails_cleanly() {
        let manager = manager();
        let mut spec = long_running("a", Duration::from_mins(15));
        spec.program = "definitely-not-a-real-program.exe".into();

        assert_eq!(manager.start(spec).unwrap_err().kind(), "io");
        assert_eq!(manager.count(), 0);
    }

    #[test]
    fn processes_that_exit_by_themselves_are_reaped() {
        let manager = manager();
        let mut spec = long_running("a", Duration::from_mins(15));
        spec.program = "cmd".into();
        spec.args = ["/c", "exit", "0"].map(OsString::from).into();
        manager.start(spec).unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        let mut ended = Vec::new();
        while ended.is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
            ended = manager.reap().ended;
        }

        assert_eq!(ended.len(), 1);
        assert_eq!(manager.count(), 0);
    }

    #[test]
    fn completion_is_reported_exactly_once() {
        let manager = manager();
        manager.start(long_running("a", Duration::ZERO)).unwrap();

        assert_eq!(manager.reap().completed.len(), 1);
        assert_eq!(manager.reap().completed.len(), 0);

        manager.stop_all();
    }

    #[test]
    fn a_waiting_timer_does_not_run_until_discord_notices_the_game() {
        let manager = manager();
        let mut spec = long_running("a", Duration::ZERO);
        spec.await_detection = true;
        let info = manager.start(spec).unwrap();

        assert_eq!(info.detection, DetectionPhase::Waiting);
        assert_eq!(info.timer_started_at(), None);
        assert!(manager.reap().completed.is_empty(), "a waiting session must not complete");
        assert_eq!(manager.pending_detection().len(), 1);

        assert!(manager.mark_detected("a", info.started_at));
        let detected = manager.snapshot().remove(0);
        assert_eq!(detected.timer_started_at(), Some(info.started_at));
        assert!(manager.pending_detection().is_empty());
        assert_eq!(manager.reap().completed.len(), 1, "the timer runs once detected");

        manager.stop_all();
    }

    #[test]
    fn evidence_older_than_the_launch_is_clamped_to_it() {
        let manager = manager();
        let mut spec = long_running("a", Duration::from_mins(15));
        spec.await_detection = true;
        let info = manager.start(spec).unwrap();

        manager.mark_detected("a", info.started_at - 60_000);
        assert_eq!(manager.snapshot()[0].detected_at, Some(info.started_at));

        manager.stop_all();
    }

    #[test]
    fn detection_changes_only_apply_to_waiting_sessions() {
        let manager = manager();
        manager.start(long_running("a", Duration::from_mins(15))).unwrap();

        assert!(!manager.mark_detected("a", 1), "a session that never waited is left alone");
        assert!(!manager.mark_unverifiable("a"));
        assert!(!manager.mark_detected("missing", 1));
        assert_eq!(manager.snapshot()[0].detection, DetectionPhase::Off);

        manager.stop_all();
    }

    #[test]
    fn an_unverifiable_session_falls_back_to_the_launch_time() {
        let manager = manager();
        let mut spec = long_running("a", Duration::ZERO);
        spec.await_detection = true;
        manager.start(spec).unwrap();

        assert!(manager.mark_unverifiable("a"));
        assert_eq!(manager.reap().completed.len(), 1);

        manager.stop_all();
    }

    #[test]
    fn stop_all_terminates_every_session() {
        let manager = manager();
        manager.start(long_running("a", Duration::from_mins(15))).unwrap();
        let mut other = long_running("b", Duration::from_mins(15));
        other.game_id = "2".into();
        manager.start(other).unwrap();

        assert_eq!(manager.stop_all().len(), 2);
        assert_eq!(manager.count(), 0);
    }
}
