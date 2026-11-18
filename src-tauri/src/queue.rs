//! The quest queue: plays the games of several "play" quests at the same time.
//!
//! Discord counts the playtime of every detected game, not only the one it puts
//! forward, so the games of all queued quests run together (up to
//! [`MAX_PLAYING`]): the whole queue takes as long as its longest quest, not the
//! sum of them. Each game runs until Discord confirms its quest (seen by
//! [`crate::quest_watch`]); a quest added while the queue is full waits for a slot.
//! Nothing here writes to the account: the quests must already be accepted.
//!
//! An item also ends when its game stops (the user stopped it, or it exited),
//! when it fails to start, or when Discord stays silent for [`GRACE_MINUTES`]
//! past the time the quest asks for, so a quest Discord never confirms cannot
//! keep its slot forever.
//!
//! [`QueueState`] is the pure state machine (unit tested); the functions below
//! it drive it with the app: starting games, stopping them, telling the UI.

use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppError;
use crate::games::model::{Game, Support};
use crate::launcher;
use crate::process::sessions::SessionInfo;
use crate::quests::model::{Quest, QuestStatus, TaskKind};
use crate::settings::{MAX_QUEST_MINUTES, MIN_QUEST_MINUTES};
use crate::state::{EVENT_QUEUE_CHANGED, Shared};
use crate::util::now_millis;

/// How long past the quest's own duration an item waits for Discord to confirm it.
/// Covers the wait for detection (up to Discord's 5-minute heartbeat) and the
/// minute or so Discord takes to validate a quest.
pub const GRACE_MINUTES: u64 = 30;
/// Games the queue runs at the same time; further quests wait for a slot.
pub const MAX_PLAYING: usize = 10;
/// The finished items kept for the UI.
const DONE_KEPT: usize = 20;

/// One quest of the queue and the fake game that completes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    pub quest_id: String,
    pub quest_name: String,
    pub game_id: String,
    pub game_name: String,
    pub executable: String,
    /// Playtime Discord still wants, in minutes.
    pub minutes: u32,
}

/// How an item left the queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// Discord confirmed the quest.
    Completed,
    /// Its game was stopped before Discord confirmed the quest.
    Skipped,
    /// Its game could not be started.
    Failed,
    /// Discord did not confirm the quest in time.
    TimedOut,
}

/// A quest whose game is running (or starting).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayingItem {
    pub item: QueueItem,
    /// `None` while its game is being started.
    pub session_id: Option<String>,
    /// Unix milliseconds.
    pub started_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishedItem {
    pub item: QueueItem,
    pub outcome: Outcome,
    pub message: Option<String>,
    /// Unix milliseconds.
    pub at: i64,
}

/// Everything the UI shows about the queue (payload of [`EVENT_QUEUE_CHANGED`]).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueueStatus {
    /// The quests whose games run now, in the order they started.
    pub playing: Vec<PlayingItem>,
    /// Quests waiting for a free slot.
    pub pending: Vec<QueueItem>,
    /// Newest first.
    pub done: Vec<FinishedItem>,
}

impl QueueStatus {
    /// Whether anything is still to be played.
    pub fn is_active(&self) -> bool {
        !self.playing.is_empty() || !self.pending.is_empty()
    }
}

/// The queue's state machine. Every method is pure: the caller acts on what it returns.
#[derive(Debug, Default)]
pub struct QueueState {
    status: QueueStatus,
    /// When the current run of the queue began (Unix ms): its end is summed up from there.
    run_started_at: Option<i64>,
}

impl QueueState {
    pub fn status(&self) -> &QueueStatus {
        &self.status
    }

    fn contains(&self, quest_id: &str) -> bool {
        self.status.playing.iter().any(|playing| playing.item.quest_id == quest_id)
            || self.status.pending.iter().any(|item| item.quest_id == quest_id)
    }

    /// Adds items at the end; a quest already queued is not added twice.
    /// Returns how many were added.
    pub fn enqueue(&mut self, items: impl IntoIterator<Item = QueueItem>) -> usize {
        let idle = !self.status.is_active();
        let mut added = 0;
        for item in items {
            if !self.contains(&item.quest_id) {
                self.status.pending.push(item);
                added += 1;
            }
        }
        if idle && added > 0 {
            self.run_started_at = Some(self.status.done.first().map_or(i64::MIN, |done| done.at + 1));
        }
        added
    }

    /// Once a run of the queue is over (nothing left to play): how many of its
    /// quests Discord confirmed, out of how many. Answers once per run.
    pub fn take_run_summary(&mut self) -> Option<(usize, usize)> {
        if self.status.is_active() {
            return None;
        }
        let since = self.run_started_at.take()?;
        let run: Vec<&FinishedItem> = self.status.done.iter().filter(|done| done.at >= since).collect();
        let completed = run.iter().filter(|done| done.outcome == Outcome::Completed).count();
        (!run.is_empty()).then_some((completed, run.len()))
    }

    /// Promotes the next pending item when a slot is free.
    pub fn next_to_start(&mut self, now: i64) -> Option<QueueItem> {
        if self.status.playing.len() >= MAX_PLAYING || self.status.pending.is_empty() {
            return None;
        }
        let item = self.status.pending.remove(0);
        self.status.playing.push(PlayingItem { item: item.clone(), session_id: None, started_at: now });
        Some(item)
    }

    /// The game of `quest_id` is running as `session_id`.
    pub fn started(&mut self, quest_id: &str, session_id: String) {
        if let Some(playing) = self.status.playing.iter_mut().find(|playing| playing.item.quest_id == quest_id) {
            playing.session_id = Some(session_id);
        }
    }

    /// Ends a playing item. Returns its session, which the caller stops if no other item uses it.
    pub fn finish(&mut self, quest_id: &str, outcome: Outcome, message: Option<String>, now: i64) -> Option<String> {
        let index = self.status.playing.iter().position(|playing| playing.item.quest_id == quest_id)?;
        let playing = self.status.playing.remove(index);
        self.push_done(FinishedItem { item: playing.item, outcome, message, at: now });
        playing.session_id
    }

    fn push_done(&mut self, finished: FinishedItem) {
        self.status.done.insert(0, finished);
        self.status.done.truncate(DONE_KEPT);
    }

    /// Whether a playing item still runs in `session_id` (two quests of one game share it).
    pub fn uses_session(&self, session_id: &str) -> bool {
        self.status.playing.iter().any(|playing| playing.session_id.as_deref() == Some(session_id))
    }

    /// A game stopped: the items it was playing are over (skipped). Returns whether there were any.
    pub fn session_ended(&mut self, session_id: &str, now: i64) -> bool {
        let quests: Vec<String> = self
            .status
            .playing
            .iter()
            .filter(|playing| playing.session_id.as_deref() == Some(session_id))
            .map(|playing| playing.item.quest_id.clone())
            .collect();
        for quest in &quests {
            self.finish(quest, Outcome::Skipped, None, now);
        }
        !quests.is_empty()
    }

    /// Discord confirmed these quests. Returns the sessions of the items that were
    /// playing them, and whether anything changed. Pending items that Discord
    /// confirmed meanwhile (played elsewhere) leave the queue too.
    pub fn quests_completed(&mut self, quest_ids: &HashSet<&str>, now: i64) -> (Vec<String>, bool) {
        let finished: Vec<String> = self
            .status
            .playing
            .iter()
            .filter(|playing| quest_ids.contains(playing.item.quest_id.as_str()))
            .map(|playing| playing.item.quest_id.clone())
            .collect();
        let mut changed = !finished.is_empty();
        let sessions = finished.iter().filter_map(|quest| self.finish(quest, Outcome::Completed, None, now)).collect();

        let (done, pending): (Vec<QueueItem>, Vec<QueueItem>) =
            std::mem::take(&mut self.status.pending).into_iter().partition(|item| quest_ids.contains(item.quest_id.as_str()));
        self.status.pending = pending;
        for item in done {
            self.push_done(FinishedItem { item, outcome: Outcome::Completed, message: None, at: now });
            changed = true;
        }
        (sessions, changed)
    }

    /// Ends the items Discord stayed silent about for too long. Returns their sessions.
    pub fn timed_out(&mut self, now: i64) -> Vec<String> {
        let late: Vec<String> = self
            .status
            .playing
            .iter()
            .filter(|playing| {
                let limit_ms = (u64::from(playing.item.minutes) + GRACE_MINUTES) * 60_000;
                let elapsed = u64::try_from(now.saturating_sub(playing.started_at)).unwrap_or(0);
                playing.session_id.is_some() && elapsed >= limit_ms
            })
            .map(|playing| playing.item.quest_id.clone())
            .collect();
        late.iter().filter_map(|quest| self.finish(quest, Outcome::TimedOut, None, now)).collect()
    }

    /// Empties the queue. Returns the sessions of the items that were playing, to stop.
    pub fn clear(&mut self) -> Vec<String> {
        self.run_started_at = None;
        self.status.pending.clear();
        self.status.done.clear();
        std::mem::take(&mut self.status.playing).into_iter().filter_map(|playing| playing.session_id).collect()
    }

    /// Removes one pending quest.
    pub fn remove(&mut self, quest_id: &str) -> bool {
        let before = self.status.pending.len();
        self.status.pending.retain(|item| item.quest_id != quest_id);
        self.status.pending.len() != before
    }

    pub fn is_current_session(&self, session_id: &str) -> bool {
        self.uses_session(session_id)
    }

    /// Restores a queue saved by a previous run: the items that were playing go first.
    pub fn restore(&mut self, saved: QueueStatus) -> usize {
        let items = saved.playing.into_iter().map(|playing| playing.item).chain(saved.pending);
        self.enqueue(items)
    }
}

/// The queue as the app holds it. It is saved with the running games, in the
/// resume point (see [`crate::resume`]), so a closed app can pick it up again.
#[derive(Default)]
pub struct QuestQueue {
    state: Mutex<QueueState>,
}

impl QuestQueue {
    pub fn lock(&self) -> MutexGuard<'_, QueueState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn status(&self) -> QueueStatus {
        self.lock().status().clone()
    }

    pub fn is_current_session(&self, session_id: &str) -> bool {
        self.lock().is_current_session(session_id)
    }
}

// ------------------------------------------------------------ from quests

/// What Discord still wants from a quest's "play on desktop" task, in whole minutes.
pub fn remaining_minutes(quest: &Quest) -> Option<u32> {
    let task = quest.tasks.iter().find(|task| task.kind == TaskKind::PlayOnDesktop)?;
    let remaining = task.target_seconds.saturating_sub(quest.progress_seconds.unwrap_or(0));
    let minutes = u32::try_from(remaining.div_ceil(60)).unwrap_or(MAX_QUEST_MINUTES);
    Some(minutes.clamp(MIN_QUEST_MINUTES, MAX_QUEST_MINUTES))
}

/// Whether a fake game can do this quest now: accepted, unfinished, asks to play on a PC.
pub fn is_playable_quest(quest: &Quest, now: i64) -> bool {
    quest.status == QuestStatus::Enrolled
        && quest.expires_at.is_none_or(|at| at > now)
        && quest.tasks.iter().any(|task| task.kind == TaskKind::PlayOnDesktop)
}

/// The games that count for a quest, best first: the one it names, then the others it accepts.
fn candidate_ids(quest: &Quest) -> Vec<&str> {
    let mut ids: Vec<&str> = quest.application_id.as_deref().into_iter().collect();
    for id in &quest.eligible_application_ids {
        if !ids.contains(&id.as_str()) {
            ids.push(id);
        }
    }
    ids
}

/// The queue item for `quest`, with the first of its games that `find` knows
/// and that has an executable this platform can run.
pub fn item_for(quest: &Quest, find: impl Fn(&str) -> Option<Game>) -> Option<QueueItem> {
    let minutes = remaining_minutes(quest)?;
    candidate_ids(quest).into_iter().find_map(|id| {
        let game = find(id)?;
        let executable = game.executables.iter().find(|executable| executable.support == Support::Ok)?;
        Some(QueueItem {
            quest_id: quest.id.clone(),
            quest_name: quest.name.clone(),
            game_id: game.id.clone(),
            game_name: game.name.clone(),
            executable: executable.name.clone(),
            minutes,
        })
    })
}

// ----------------------------------------------------------------- driver

/// Saves the queue and tells the UI (and the tray) what it now looks like.
pub fn changed(app: &AppHandle) {
    let state = app.state::<Shared>();
    let _ = app.emit(EVENT_QUEUE_CHANGED, state.queue.status());
    state.save_resume_point();
    crate::lifecycle::refresh_tray(app);
}

/// Adds items and starts them at once (as many as there are free slots). Returns how many were added.
pub fn enqueue(app: &AppHandle, items: Vec<QueueItem>) -> usize {
    let state = app.state::<Shared>();
    let added = state.queue.lock().enqueue(items);
    if added > 0 {
        state.log.info(format!("{added} quest(s) added to the queue."));
        changed(app);
        kick(app);
    }
    added
}

/// Adds the accepted "play" quests among `quests` whose game the app can find.
pub async fn enqueue_quests(app: &AppHandle, quests: &[Quest]) -> usize {
    let state = app.state::<Shared>();
    // The catalog may not be loaded yet when this runs in the background (started in the tray).
    let _ = state.catalog.load_local().await;

    let now = now_millis();
    let mut items = Vec::new();
    for quest in quests.iter().filter(|quest| is_playable_quest(quest, now)) {
        match item_for(quest, |id| launcher::find_game(&state, id).ok()) {
            Some(item) => items.push(item),
            None => state.log.warn(format!("No playable game found for the quest “{}”: add it by hand.", quest.name)),
        }
    }
    enqueue(app, items)
}

/// Starts the waiting items that have a free slot, in the background.
pub fn kick(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { advance(&app).await });
}

/// Starts items while slots are free; announces the end once nothing is left.
async fn advance(app: &AppHandle) {
    let state = app.state::<Shared>();
    loop {
        let Some(item) = state.queue.lock().next_to_start(now_millis()) else {
            announce_end(app);
            return;
        };
        changed(app);

        let started = launcher::start_session(&state, &item.game_id, &item.executable, Some(item.minutes)).await;
        let session = match started {
            Ok(session) => Some(session),
            // Already running (started by hand, or by another quest of the same game): the queue follows it.
            Err(AppError::AlreadyRunning(_)) => {
                state.sessions.snapshot().into_iter().find(|session| session.game_id == item.game_id)
            }
            Err(error) => {
                state.log.error(format!("Queue: could not start {} for “{}”: {error}", item.game_name, item.quest_name));
                state.queue.lock().finish(&item.quest_id, Outcome::Failed, Some(error.to_string()), now_millis());
                changed(app);
                continue;
            }
        };

        // Reported as running, yet already gone: nothing to follow, move on rather than wait forever.
        let Some(session) = session else {
            state.queue.lock().finish(&item.quest_id, Outcome::Failed, None, now_millis());
            changed(app);
            continue;
        };
        state.log.info(format!("Queue: {} started for “{}” ({} min).", item.game_name, item.quest_name, item.minutes));
        state.queue.lock().started(&item.quest_id, session.id);
        state.broadcast_sessions(app);
        changed(app);
    }
}

/// Tells the user, once, that the queue played everything it had.
fn announce_end(app: &AppHandle) {
    let state = app.state::<Shared>();
    let Some((completed, total)) = state.queue.lock().take_run_summary() else { return };
    state.log.info(format!("Queue finished: Discord confirmed {completed} of {total} quest(s)."));
    let settings = state.settings.get();
    if settings.notify_on_complete {
        let lang = crate::locale::Lang::resolve(settings.language);
        crate::lifecycle::notify(app, lang.queue_done_title(), &lang.queue_done_body(completed, total));
    }
}

/// Stops the sessions the queue no longer needs (a game shared by two quests keeps
/// running while one of them still plays), books their playtime and tells the UI.
fn stop_sessions(app: &AppHandle, session_ids: Vec<String>) {
    let state = app.state::<Shared>();
    let mut stopped = Vec::new();
    for session_id in session_ids {
        if state.queue.lock().uses_session(&session_id) {
            continue;
        }
        if let Ok(session) = state.sessions.stop(&session_id) {
            stopped.push(session);
        }
    }
    if !stopped.is_empty() {
        state.finish_sessions(app, &stopped);
        state.broadcast_sessions(app);
    }
}

/// Called by the session watcher with the games that just stopped.
pub fn sessions_ended(app: &AppHandle, ended: &[SessionInfo]) {
    if ended.is_empty() {
        return;
    }
    let state = app.state::<Shared>();
    let now = now_millis();
    let any = ended.iter().fold(false, |any, session| state.queue.lock().session_ended(&session.id, now) | any);
    if any {
        state.log.info("Queue: a game stopped before Discord confirmed its quest.");
        changed(app);
        kick(app);
    }
}

/// Called by the session watcher every second: gives up on quests Discord stays silent about.
pub fn check_timeout(app: &AppHandle) {
    let state = app.state::<Shared>();
    let sessions = state.queue.lock().timed_out(now_millis());
    if sessions.is_empty() {
        return;
    }
    state.log.warn(format!("Queue: Discord did not confirm a quest within {GRACE_MINUTES} min of its duration, giving up on it."));
    stop_sessions(app, sessions);
    changed(app);
    kick(app);
}

/// Called with the quests Discord just confirmed.
pub fn quests_completed(app: &AppHandle, completed: &[Quest]) {
    if completed.is_empty() {
        return;
    }
    let state = app.state::<Shared>();
    let ids: HashSet<&str> = completed.iter().map(|quest| quest.id.as_str()).collect();
    let (sessions, any) = state.queue.lock().quests_completed(&ids, now_millis());
    if any {
        stop_sessions(app, sessions);
        changed(app);
        kick(app);
    }
}

/// Gives up on one playing quest now (its game stops) and lets a waiting one take its slot.
pub fn skip(app: &AppHandle, quest_id: &str) {
    let state = app.state::<Shared>();
    let session = state.queue.lock().finish(quest_id, Outcome::Skipped, None, now_millis());
    stop_sessions(app, session.into_iter().collect());
    changed(app);
    kick(app);
}

/// Empties the queue and stops the games it was playing.
pub fn clear(app: &AppHandle) {
    let state = app.state::<Shared>();
    let sessions = state.queue.lock().clear();
    stop_sessions(app, sessions);
    changed(app);
}

/// Empties the queue without stopping anything (the caller stops every game itself).
pub fn forget(app: &AppHandle) {
    let state = app.state::<Shared>();
    let was_active = {
        let mut queue = state.queue.lock();
        let active = queue.status().is_active();
        queue.clear();
        active
    };
    if was_active {
        changed(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::model::Executable;
    use crate::quests::model::QuestTask;

    fn item(quest: &str) -> QueueItem {
        QueueItem {
            quest_id: quest.into(),
            quest_name: format!("Quest {quest}"),
            game_id: format!("1{quest}"),
            game_name: format!("Game {quest}"),
            executable: "game.exe".into(),
            minutes: 15,
        }
    }

    fn ids(quests: &[&'static str]) -> HashSet<&'static str> {
        quests.iter().copied().collect()
    }

    fn start_all(queue: &mut QueueState, now: i64) {
        while let Some(item) = queue.next_to_start(now) {
            let session = format!("s-{}", item.quest_id);
            queue.started(&item.quest_id, session);
        }
    }

    #[test]
    fn every_quest_plays_at_the_same_time() {
        let mut queue = QueueState::default();
        assert_eq!(queue.enqueue([item("a"), item("b")]), 2);
        start_all(&mut queue, 0);

        assert_eq!(queue.status().playing.len(), 2, "Discord counts every detected game");
        assert!(queue.status().pending.is_empty());

        assert!(queue.session_ended("s-a", 10));
        assert_eq!(queue.status().done[0].outcome, Outcome::Skipped);
        assert_eq!(queue.status().playing[0].item.quest_id, "b");
    }

    #[test]
    fn quests_beyond_the_limit_wait_for_a_slot() {
        let mut queue = QueueState::default();
        queue.enqueue((0..=MAX_PLAYING).map(|index| item(&index.to_string())));
        start_all(&mut queue, 0);
        assert_eq!(queue.status().playing.len(), MAX_PLAYING);
        assert_eq!(queue.status().pending.len(), 1);

        queue.session_ended("s-0", 1);
        assert_eq!(queue.next_to_start(1).unwrap().quest_id, MAX_PLAYING.to_string());
    }

    #[test]
    fn a_quest_is_never_queued_twice() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a")]);
        queue.next_to_start(0);
        assert_eq!(queue.enqueue([item("a"), item("b"), item("b")]), 1);
        assert_eq!(queue.status().pending.len(), 1);
    }

    #[test]
    fn discord_confirming_quests_ends_them_and_returns_their_games() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a"), item("b")]);
        start_all(&mut queue, 0);
        queue.enqueue([item("c")]);

        // `c` was completed elsewhere meanwhile: it leaves the queue too.
        let (sessions, changed) = queue.quests_completed(&ids(&["a", "c"]), 5);
        assert!(changed);
        assert_eq!(sessions, ["s-a"]);
        assert_eq!(queue.status().playing.len(), 1);
        assert!(queue.status().pending.is_empty());
        assert!(queue.status().done.iter().all(|done| done.outcome == Outcome::Completed));
    }

    #[test]
    fn two_quests_of_one_game_share_its_session() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a"), item("b")]);
        queue.next_to_start(0);
        queue.next_to_start(0);
        queue.started("a", "shared".into());
        queue.started("b", "shared".into());

        let (sessions, _) = queue.quests_completed(&ids(&["a"]), 1);
        assert_eq!(sessions, ["shared"]);
        assert!(queue.uses_session("shared"), "the game keeps running for the other quest");
    }

    #[test]
    fn another_game_stopping_does_not_touch_the_queue() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a")]);
        start_all(&mut queue, 0);
        assert!(!queue.session_ended("other", 1));
        assert_eq!(queue.status().playing.len(), 1);
    }

    #[test]
    fn a_quest_discord_never_confirms_times_out() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a")]);
        queue.next_to_start(0);
        assert!(queue.timed_out(i64::MAX).is_empty(), "not while the game is still starting");
        queue.started("a", "s-a".into());

        let limit = i64::try_from((15 + GRACE_MINUTES) * 60_000).unwrap();
        assert!(queue.timed_out(limit - 1).is_empty());
        assert_eq!(queue.timed_out(limit), ["s-a"]);
        assert_eq!(queue.status().done[0].outcome, Outcome::TimedOut);
    }

    #[test]
    fn the_end_of_a_run_is_summed_up_once() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a"), item("b")]);
        start_all(&mut queue, 0);
        assert!(queue.take_run_summary().is_none(), "still playing");

        queue.quests_completed(&ids(&["a"]), 1);
        queue.session_ended("s-b", 2);

        assert_eq!(queue.take_run_summary(), Some((1, 2)));
        assert!(queue.take_run_summary().is_none(), "only once");

        // A later run only counts its own items.
        queue.enqueue([item("c")]);
        start_all(&mut queue, 3);
        queue.quests_completed(&ids(&["c"]), 4);
        assert_eq!(queue.take_run_summary(), Some((1, 1)));
    }

    #[test]
    fn clearing_returns_the_games_to_stop() {
        let mut queue = QueueState::default();
        queue.enqueue([item("a"), item("b")]);
        start_all(&mut queue, 0);
        assert_eq!(queue.clear(), ["s-a", "s-b"]);
        assert!(!queue.status().is_active());
    }

    #[test]
    fn a_saved_queue_restarts_with_the_items_that_were_playing() {
        let mut saved = QueueState::default();
        saved.enqueue([item("a"), item("b")]);
        saved.next_to_start(0);

        let mut queue = QueueState::default();
        assert_eq!(queue.restore(saved.status().clone()), 2);
        assert_eq!(queue.next_to_start(0).unwrap().quest_id, "a");
    }

    fn quest(status: QuestStatus, target: u64, progress: Option<u64>) -> Quest {
        Quest {
            id: "q".into(),
            name: "Quest".into(),
            game_title: None,
            publisher: None,
            application_id: Some("10".into()),
            eligible_application_ids: vec!["20".into(), "10".into()],
            any_task: false,
            reward: None,
            reward_orbs: None,
            starts_at: None,
            expires_at: None,
            tasks: vec![QuestTask { kind: TaskKind::PlayOnDesktop, target_seconds: target }],
            status,
            progress_seconds: progress,
            completed_at: None,
            claimed_at: None,
        }
    }

    fn game(id: &str, support: Support) -> Game {
        let mut game: Game = serde_json::from_value(serde_json::json!({
            "id": id, "name": format!("Game {id}"), "executables": [{ "name": "game.exe", "os": "win32" }],
        }))
        .unwrap();
        game.executables = vec![Executable { support, ..game.executables[0].clone() }];
        game
    }

    #[test]
    fn the_queue_plays_only_what_discord_still_wants() {
        assert_eq!(remaining_minutes(&quest(QuestStatus::Enrolled, 900, None)), Some(15));
        assert_eq!(remaining_minutes(&quest(QuestStatus::Enrolled, 900, Some(600))), Some(5));
        assert_eq!(remaining_minutes(&quest(QuestStatus::Enrolled, 900, Some(899))), Some(1));
        assert_eq!(remaining_minutes(&quest(QuestStatus::Enrolled, 900, Some(5000))), Some(MIN_QUEST_MINUTES));
    }

    #[test]
    fn only_accepted_unfinished_pc_quests_are_playable() {
        assert!(is_playable_quest(&quest(QuestStatus::Enrolled, 900, None), 0));
        assert!(!is_playable_quest(&quest(QuestStatus::Available, 900, None), 0));
        assert!(!is_playable_quest(&quest(QuestStatus::Completed, 900, None), 0));
        let mut expired = quest(QuestStatus::Enrolled, 900, None);
        expired.expires_at = Some(10);
        assert!(!is_playable_quest(&expired, 10));
    }

    #[test]
    fn the_named_game_is_preferred_then_any_playable_eligible_one() {
        let quest = quest(QuestStatus::Enrolled, 900, None);
        let both = |id: &str| Some(game(id, Support::Ok));
        assert_eq!(item_for(&quest, both).unwrap().game_id, "10");

        let only_eligible = |id: &str| (id == "20").then(|| game(id, Support::Ok));
        assert_eq!(item_for(&quest, only_eligible).unwrap().game_id, "20");

        let unplayable = |id: &str| Some(game(id, Support::OtherPlatform));
        assert!(item_for(&quest, unplayable).is_none());
    }
}
