//! What the app itself helped complete.
//!
//! Discord already reports every quest of the account, so the totals of the
//! account (finished, expired, Orbs earned…) are computed from that list. What
//! Discord cannot say is which quests were finished *thanks to this app*: that
//! is what is remembered here, in `stats.json`, each time Discord confirms a
//! quest for a game the app was playing.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage;

/// How many of the latest quests the summary lists.
const RECENT_COUNT: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedQuest {
    pub quest_id: String,
    pub name: String,
    /// Orbs the quest granted, when its reward was Orbs.
    pub orbs: Option<u64>,
    /// When Discord confirmed the quest, in Unix milliseconds.
    pub completed_at: i64,
    /// What the quest asked for (play time or video length), in seconds: the time the app saved.
    #[serde(default)]
    pub seconds: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StatsFile {
    completed: Vec<CompletedQuest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStats {
    pub quests_completed: usize,
    pub orbs_earned: u64,
    /// Play or video time the app did in the user's place.
    pub time_saved_seconds: u64,
    /// The last weeks, oldest first, empty weeks included.
    pub weekly: Vec<WeekStats>,
    /// The latest ones, newest first.
    pub recent: Vec<CompletedQuest>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekStats {
    /// Monday 00:00 UTC of the week, in Unix milliseconds.
    pub week_start: i64,
    pub orbs: u64,
    pub quests: u32,
}

/// The Unix epoch is a Thursday: Mondays fall 4 days after it.
const MONDAY_OFFSET_MS: i64 = 4 * DAY_MS;
const DAY_MS: i64 = 86_400_000;
const WEEK_MS: i64 = 7 * DAY_MS;
/// How many weeks the summary covers.
const WEEKS: u8 = 8;

fn week_index(at: i64) -> i64 {
    (at - MONDAY_OFFSET_MS).div_euclid(WEEK_MS)
}

pub struct StatsStore {
    file: PathBuf,
    completed: Mutex<Vec<CompletedQuest>>,
}

impl StatsStore {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let stored: StatsFile = storage::read_json(&file)?.unwrap_or_default();
        Ok(Self { file, completed: Mutex::new(stored.completed) })
    }

    /// Remembers a quest. Returns `false` when it was already counted.
    pub fn record(&self, quest: CompletedQuest) -> AppResult<bool> {
        let mut completed = self.lock();
        if completed.iter().any(|known| known.quest_id == quest.quest_id) {
            return Ok(false);
        }

        completed.push(quest);
        storage::write_json(&self.file, &StatsFile { completed: completed.clone() })?;
        Ok(true)
    }

    pub fn summary(&self, now: i64) -> AppStats {
        let completed = self.lock();
        let mut recent = completed.clone();
        recent.sort_by_key(|quest| std::cmp::Reverse(quest.completed_at));
        recent.truncate(RECENT_COUNT);

        let current = week_index(now);
        let weekly = (0..WEEKS)
            .rev()
            .map(|ago| {
                let week = current - i64::from(ago);
                let of_week = completed.iter().filter(|quest| week_index(quest.completed_at) == week);
                WeekStats {
                    week_start: week * WEEK_MS + MONDAY_OFFSET_MS,
                    orbs: of_week.clone().filter_map(|quest| quest.orbs).sum(),
                    quests: u32::try_from(of_week.count()).unwrap_or(u32::MAX),
                }
            })
            .collect();

        AppStats {
            quests_completed: completed.len(),
            orbs_earned: completed.iter().filter_map(|quest| quest.orbs).sum(),
            time_saved_seconds: completed.iter().filter_map(|quest| quest.seconds).sum(),
            weekly,
            recent,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Vec<CompletedQuest>> {
        self.completed.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quest(id: &str, orbs: Option<u64>, completed_at: i64) -> CompletedQuest {
        CompletedQuest { quest_id: id.into(), name: format!("Quest {id}"), orbs, completed_at, seconds: Some(60) }
    }

    fn store() -> (tempfile::TempDir, StatsStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = StatsStore::load(dir.path().join("stats.json")).unwrap();
        (dir, store)
    }

    #[test]
    fn a_new_store_has_nothing_to_report() {
        let (_dir, store) = store();
        let summary = store.summary(0);
        assert_eq!((summary.quests_completed, summary.orbs_earned, summary.time_saved_seconds), (0, 0, 0));
        assert!(summary.recent.is_empty());
        assert_eq!(summary.weekly.len(), usize::from(WEEKS));
    }

    #[test]
    fn orbs_are_summed_and_quests_without_orbs_still_count() {
        let (_dir, store) = store();
        store.record(quest("a", Some(700), 1)).unwrap();
        store.record(quest("b", None, 2)).unwrap();
        store.record(quest("c", Some(200), 3)).unwrap();

        let summary = store.summary(10);
        assert_eq!((summary.quests_completed, summary.orbs_earned), (3, 900));
    }

    #[test]
    fn a_quest_is_never_counted_twice() {
        let (_dir, store) = store();
        assert!(store.record(quest("a", Some(700), 1)).unwrap());
        assert!(!store.record(quest("a", Some(700), 2)).unwrap());
        assert_eq!(store.summary(10).orbs_earned, 700);
    }

    #[test]
    fn the_latest_quests_come_first_and_are_capped() {
        let (_dir, store) = store();
        for index in 0..8 {
            store.record(quest(&index.to_string(), None, index)).unwrap();
        }

        let recent = store.summary(10).recent;
        assert_eq!(recent.len(), RECENT_COUNT);
        assert_eq!(recent[0].quest_id, "7");
    }

    #[test]
    fn time_saved_is_summed() {
        let (_dir, store) = store();
        store.record(quest("a", None, 1)).unwrap();
        store.record(quest("b", None, 2)).unwrap();
        assert_eq!(store.summary(10).time_saved_seconds, 120);
    }

    #[test]
    fn quests_are_grouped_by_week_ending_with_the_current_one() {
        let (_dir, store) = store();
        let now = 100 * DAY_MS;
        store.record(quest("a", Some(700), now)).unwrap();
        store.record(quest("b", Some(200), now - 8 * DAY_MS)).unwrap();
        store.record(quest("c", Some(50), now - 400 * DAY_MS)).unwrap();

        let weekly = store.summary(now).weekly;
        assert_eq!(weekly.len(), usize::from(WEEKS));
        assert_eq!(weekly[usize::from(WEEKS) - 1].orbs, 700);
        assert_eq!(weekly.iter().map(|week| week.orbs).sum::<u64>(), 900);
        assert!(weekly.windows(2).all(|pair| pair[1].week_start - pair[0].week_start == WEEK_MS));
    }

    #[test]
    fn the_totals_survive_a_restart() {
        let (dir, store) = store();
        store.record(quest("a", Some(700), 1)).unwrap();

        let restarted = StatsStore::load(dir.path().join("stats.json")).unwrap();
        assert_eq!(restarted.summary(10).orbs_earned, 700);
    }
}
