//! Watches the Discord quests while the app runs.
//!
//! * while a fake game runs, the quests are read once a minute: the progress
//!   Discord reports reaches the UI by itself, and a quest Discord marks as
//!   completed can stop the game that was running for it;
//! * otherwise they are read every 20 minutes, only to announce new quests
//!   (and only if the user asked for those notifications).
//!
//! Nothing here talks to Discord directly: it all goes through
//! [`QuestService`](crate::quests::QuestService), which keeps the token safe.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::error::AppError;
use crate::games::library::LibraryEntry;
use crate::lifecycle;
use crate::locale::Lang;
use crate::process::sessions::SessionInfo;
use crate::quests::QuestSync;
use crate::quests::model::Quest;
use crate::quests::tracker::QuestChanges;
use crate::state::{EVENT_QUEST_DONE, EVENT_QUESTS_DISCONNECTED, EVENT_QUESTS_UPDATED, EVENT_STATS_CHANGED, Shared};
use crate::stats::CompletedQuest;
use crate::util::now_millis;

/// How often the loop wakes up to see whether a look at the quests is due.
const CHECK_EVERY: Duration = Duration::from_secs(20);
/// Gives the window time to start before the first request.
const STARTUP_DELAY: Duration = Duration::from_secs(15);
/// Discord updates the progress about once a minute, so looking faster is useless.
const ACTIVE_INTERVAL: Duration = Duration::from_secs(60);
const IDLE_INTERVAL: Duration = Duration::from_secs(20 * 60);
/// After a failure (network down, rate limit…) the next look waits at least this long.
const ERROR_BACKOFF: Duration = Duration::from_secs(5 * 60);

/// A quest counts as the app's work when it played the quest's game that recently.
/// Discord confirms a quest a little after the playtime is reached, and the game
/// may be stopped by then (the longest timer is eight hours).
const CREDIT_WINDOW_MS: i64 = 12 * 3_600_000;

/// Payload of [`EVENT_QUEST_DONE`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestDone {
    pub quest_id: String,
    pub name: String,
}

/// How long to wait between two looks, or `None` when no look is wanted.
fn look_interval(running_games: usize, notify_new_quests: bool) -> Option<Duration> {
    if running_games > 0 {
        Some(ACTIVE_INTERVAL)
    } else if notify_new_quests {
        Some(IDLE_INTERVAL)
    } else {
        None
    }
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;

        let mut ticker = tokio::time::interval(CHECK_EVERY);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        let mut last_look: Option<Instant> = None;
        let mut backoff = Duration::ZERO;
        let mut failing = false;

        loop {
            ticker.tick().await;
            let state = app.state::<Shared>();

            let Some(interval) = look_interval(state.sessions.count(), state.settings.get().notify_new_quests) else {
                continue;
            };
            if last_look.is_some_and(|at| at.elapsed() < interval.max(backoff)) {
                continue;
            }
            last_look = Some(Instant::now());

            backoff = Duration::ZERO;
            match look(&app).await {
                // Not connected: there is nothing to watch.
                Ok(()) | Err(AppError::TokenMissing) => failing = false,
                Err(AppError::TokenInvalid) => {
                    failing = false;
                    let _ = app.emit(EVENT_QUESTS_DISCONNECTED, ());
                }
                Err(error) => {
                    // Once per outage: the log is not a place for a line a minute.
                    if !failing {
                        state.log.warn(format!("Could not watch the Discord quests: {error}"));
                    }
                    failing = true;
                    backoff = ERROR_BACKOFF;
                }
            }
        }
    });
}

async fn look(app: &AppHandle) -> Result<(), AppError> {
    let QuestSync { response, changes } = app.state::<Shared>().quests.refresh().await?;
    apply(app, changes);
    let _ = app.emit(EVENT_QUESTS_UPDATED, response);
    Ok(())
}

/// Acts on what a look at the quests revealed. Called for manual refreshes
/// too, so a completion is never missed because the user happened to click.
pub fn apply(app: &AppHandle, changes: QuestChanges) {
    if changes.is_empty() {
        return;
    }

    let state = app.state::<Shared>();
    let settings = state.settings.get();
    let lang = Lang::resolve(settings.language);
    // The in-app UI already shows what happened to a focused window.
    let unseen = !lifecycle::main_window_focused(app);

    for quest in &changes.completed {
        state.log.info(format!("Discord marked “{}” as completed.", quest.name));
        let _ = app.emit(EVENT_QUEST_DONE, QuestDone { quest_id: quest.id.clone(), name: quest.name.clone() });

        if settings.notify_on_complete && unseen {
            notify(app, lang.quest_done_title(), &lang.quest_done_body(&quest.name));
        }

        credit_the_app(app, quest);
    }

    if settings.auto_stop_on_complete {
        stop_games_of(app, &changes.completed);
    }

    if !changes.new.is_empty() {
        state.log.info(format!("{} new Discord quest(s).", changes.new.len()));
        if settings.notify_new_quests && unseen {
            let names = names(&changes.new);
            notify(app, lang.new_quests_title(names.len()), &lang.new_quests_body(&names));
        }
    }

    if !changes.expiring.is_empty() {
        state.log.info(format!("{} Discord quest(s) expire within 24 h.", changes.expiring.len()));
        if settings.notify_new_quests && unseen {
            let names = names(&changes.expiring);
            notify(app, lang.expiring_quests_title(names.len()), &lang.expiring_quests_body(&names));
        }
    }
}

/// Adds the quest to the app's own totals if the app was playing its game.
fn credit_the_app(app: &AppHandle, quest: &Quest) {
    let state = app.state::<Shared>();
    let now = now_millis();
    if !played_by_the_app(quest, &state.sessions.snapshot(), &state.library.entries(), now) {
        return;
    }

    let entry = CompletedQuest {
        quest_id: quest.id.clone(),
        name: quest.name.clone(),
        orbs: quest.reward_orbs,
        completed_at: quest.completed_at.unwrap_or(now),
    };
    match state.stats.record(entry) {
        Ok(true) => {
            state.log.info(format!("“{}” counted in the app's statistics.", quest.name));
            let _ = app.emit(EVENT_STATS_CHANGED, ());
        }
        Ok(false) => {}
        Err(error) => state.log.warn(format!("Could not save the statistics: {error}")),
    }
}

/// Whether a fake game ran for the quest's game: right now, or recently enough.
fn played_by_the_app(quest: &Quest, running: &[SessionInfo], library: &[LibraryEntry], now: i64) -> bool {
    let Some(game) = quest.application_id.as_deref() else { return false };

    running.iter().any(|session| session.game_id == game)
        || library.iter().any(|entry| {
            entry.game.id == game && entry.last_played_at.is_some_and(|at| now.saturating_sub(at) <= CREDIT_WINDOW_MS)
        })
}

fn stop_games_of(app: &AppHandle, done: &[Quest]) {
    let state = app.state::<Shared>();
    let stopped: Vec<SessionInfo> = sessions_to_stop(&state.sessions.snapshot(), done)
        .iter()
        .filter_map(|id| state.sessions.stop(id).ok())
        .collect();
    if stopped.is_empty() {
        return;
    }

    for session in &stopped {
        state.log.info(format!("{} stopped: Discord confirmed the quest.", session.game_name));
    }
    state.finish_sessions(app, &stopped);
    state.broadcast_sessions(app);
}

/// The running sessions whose game is the one a completed quest asked for.
fn sessions_to_stop(sessions: &[SessionInfo], done: &[Quest]) -> Vec<String> {
    let games: HashSet<&str> = done.iter().filter_map(|quest| quest.application_id.as_deref()).collect();
    sessions
        .iter()
        .filter(|session| games.contains(session.game_id.as_str()))
        .map(|session| session.id.clone())
        .collect()
}

fn names(quests: &[Quest]) -> Vec<&str> {
    quests.iter().map(|quest| quest.name.as_str()).collect()
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::sessions::DetectionPhase;
    use crate::quests::model::QuestStatus;

    fn quest(application_id: Option<&str>) -> Quest {
        Quest {
            id: "q".into(),
            name: "Quest".into(),
            game_title: None,
            publisher: None,
            application_id: application_id.map(str::to_owned),
            reward: None,
            reward_orbs: None,
            starts_at: None,
            expires_at: None,
            tasks: Vec::new(),
            status: QuestStatus::Completed,
            progress_seconds: None,
            completed_at: None,
            claimed_at: None,
        }
    }

    fn session(id: &str, game_id: &str) -> SessionInfo {
        SessionInfo {
            id: id.into(),
            game_id: game_id.into(),
            game_name: "Game".into(),
            executable: "game.exe".into(),
            path: "game.exe".into(),
            pid: 1,
            started_at: 0,
            target_seconds: 900,
            detection: DetectionPhase::Off,
            detected_at: None,
        }
    }

    #[test]
    fn quests_are_looked_at_faster_while_a_game_runs() {
        assert_eq!(look_interval(1, false), Some(ACTIVE_INTERVAL));
        assert_eq!(look_interval(2, true), Some(ACTIVE_INTERVAL));
    }

    #[test]
    fn an_idle_app_only_looks_when_new_quests_are_wanted() {
        assert_eq!(look_interval(0, true), Some(IDLE_INTERVAL));
        assert_eq!(look_interval(0, false), None);
    }

    #[test]
    fn a_completed_quest_stops_the_games_it_asked_for() {
        let sessions = [session("a:x.exe", "1"), session("a:y.exe", "1"), session("b:z.exe", "2")];
        assert_eq!(sessions_to_stop(&sessions, &[quest(Some("1"))]), ["a:x.exe", "a:y.exe"]);
    }

    fn entry(game_id: &str, last_played_at: Option<i64>) -> LibraryEntry {
        LibraryEntry {
            game: crate::games::model::Game {
                id: game_id.into(),
                name: "Game".into(),
                aliases: Vec::new(),
                executables: Vec::new(),
                icon_hash: None,
                themes: Vec::new(),
            },
            added_at: 0,
            last_played_at,
            total_seconds: 0,
        }
    }

    #[test]
    fn a_running_game_gets_the_credit() {
        assert!(played_by_the_app(&quest(Some("1")), &[session("a", "1")], &[], 0));
    }

    #[test]
    fn a_game_played_recently_gets_the_credit_but_an_old_one_does_not() {
        let now = 100 * 3_600_000;
        let recent = [entry("1", Some(now - 2 * 3_600_000))];
        let old = [entry("1", Some(now - 20 * 3_600_000))];

        assert!(played_by_the_app(&quest(Some("1")), &[], &recent, now));
        assert!(!played_by_the_app(&quest(Some("1")), &[], &old, now));
    }

    #[test]
    fn a_game_the_app_never_played_gets_no_credit() {
        assert!(!played_by_the_app(&quest(Some("1")), &[session("b", "2")], &[entry("2", Some(0))], 0));
        assert!(!played_by_the_app(&quest(Some("1")), &[], &[entry("1", None)], 0));
        assert!(!played_by_the_app(&quest(None), &[session("a", "1")], &[], 0));
    }

    #[test]
    fn a_quest_without_a_game_stops_nothing() {
        assert!(sessions_to_stop(&[session("a", "1")], &[quest(None)]).is_empty());
    }
}
