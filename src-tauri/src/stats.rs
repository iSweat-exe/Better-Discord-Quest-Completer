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
    /// The latest ones, newest first.
    pub recent: Vec<CompletedQuest>,
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

    pub fn summary(&self) -> AppStats {
        let completed = self.lock();
        let mut recent = completed.clone();
        recent.sort_by_key(|quest| std::cmp::Reverse(quest.completed_at));
        recent.truncate(RECENT_COUNT);

        AppStats {
            quests_completed: completed.len(),
            orbs_earned: completed.iter().filter_map(|quest| quest.orbs).sum(),
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
        CompletedQuest { quest_id: id.into(), name: format!("Quest {id}"), orbs, completed_at }
    }

    fn store() -> (tempfile::TempDir, StatsStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = StatsStore::load(dir.path().join("stats.json")).unwrap();
        (dir, store)
    }

    #[test]
    fn a_new_store_has_nothing_to_report() {
        let (_dir, store) = store();
        assert_eq!(store.summary(), AppStats { quests_completed: 0, orbs_earned: 0, recent: Vec::new() });
    }

    #[test]
    fn orbs_are_summed_and_quests_without_orbs_still_count() {
        let (_dir, store) = store();
        store.record(quest("a", Some(700), 1)).unwrap();
        store.record(quest("b", None, 2)).unwrap();
        store.record(quest("c", Some(200), 3)).unwrap();

        let summary = store.summary();
        assert_eq!((summary.quests_completed, summary.orbs_earned), (3, 900));
    }

    #[test]
    fn a_quest_is_never_counted_twice() {
        let (_dir, store) = store();
        assert!(store.record(quest("a", Some(700), 1)).unwrap());
        assert!(!store.record(quest("a", Some(700), 2)).unwrap());
        assert_eq!(store.summary().orbs_earned, 700);
    }

    #[test]
    fn the_latest_quests_come_first_and_are_capped() {
        let (_dir, store) = store();
        for index in 0..8 {
            store.record(quest(&index.to_string(), None, index)).unwrap();
        }

        let recent = store.summary().recent;
        assert_eq!(recent.len(), RECENT_COUNT);
        assert_eq!(recent[0].quest_id, "7");
    }

    #[test]
    fn the_totals_survive_a_restart() {
        let (dir, store) = store();
        store.record(quest("a", Some(700), 1)).unwrap();

        let restarted = StatsStore::load(dir.path().join("stats.json")).unwrap();
        assert_eq!(restarted.summary().orbs_earned, 700);
    }
}
