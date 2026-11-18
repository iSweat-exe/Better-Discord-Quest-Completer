//! What changed between two looks at the user's quests.
//!
//! Every look at the quests goes through [`QuestTracker::observe`], which
//! tells what is worth a notification: a quest that just appeared, one that
//! Discord just validated, one that is about to expire. The ids already seen
//! are kept on disk so a quest that dropped while the app was closed is still
//! announced, and a restart does not announce the same quests again.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::model::{Quest, QuestStatus};
use crate::error::AppResult;
use crate::storage;

/// A quest this close to its deadline is worth a reminder.
const EXPIRY_WARNING_MS: i64 = 24 * 3_600_000;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct Memory {
    /// Ids of every quest listed so far (only the ones still listed are kept).
    seen: BTreeSet<String>,
    /// Ids already reminded about their deadline.
    warned: BTreeSet<String>,
    /// Ids of the quests seen accepted. `None` until the first look that records
    /// them, which only sets the baseline (the field is newer than the file).
    enrolled: Option<BTreeSet<String>>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct QuestChanges {
    /// Quests that appeared and can still be done.
    pub new: Vec<Quest>,
    /// Quests Discord has just marked as completed.
    pub completed: Vec<Quest>,
    /// Unfinished quests whose deadline is close, reported once each.
    pub expiring: Vec<Quest>,
    /// Quests that were just accepted (in Discord or in the app), reported once each.
    pub accepted: Vec<Quest>,
}

impl QuestChanges {
    pub fn is_empty(&self) -> bool {
        self.new.is_empty() && self.completed.is_empty() && self.expiring.is_empty() && self.accepted.is_empty()
    }
}

pub struct QuestTracker {
    file: PathBuf,
    /// `None` until the very first look, which only sets the baseline: a user
    /// who just connected must not be told that all their quests are new.
    memory: Option<Memory>,
    /// Status of each quest at the previous look; only lives as long as the app.
    statuses: HashMap<String, QuestStatus>,
    dirty: bool,
}

impl QuestTracker {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let memory = storage::read_json(&file)?;
        Ok(Self { file, memory, statuses: HashMap::new(), dirty: false })
    }

    /// Compares `quests` with what was seen before and remembers them.
    pub fn observe(&mut self, quests: &[Quest], now: i64) -> QuestChanges {
        let baseline = self.memory.is_none();
        let memory = self.memory.get_or_insert_with(Memory::default);
        let mut changes = QuestChanges::default();
        self.dirty |= baseline;
        let enrolled_baseline = memory.enrolled.is_none();
        let enrolled = memory.enrolled.get_or_insert_with(BTreeSet::new);
        self.dirty |= enrolled_baseline;

        for quest in quests {
            if memory.seen.insert(quest.id.clone()) {
                self.dirty = true;
                if !baseline && quest.status.is_unfinished() && !has_expired(quest, now) {
                    changes.new.push(quest.clone());
                }
            }

            let was_unfinished = self.statuses.get(&quest.id).is_some_and(|status| status.is_unfinished());
            if was_unfinished && !quest.status.is_unfinished() {
                changes.completed.push(quest.clone());
            }

            if quest.status.is_unfinished() && expires_soon(quest, now) && memory.warned.insert(quest.id.clone()) {
                self.dirty = true;
                changes.expiring.push(quest.clone());
            }

            if quest.status == QuestStatus::Enrolled && enrolled.insert(quest.id.clone()) {
                self.dirty = true;
                if !enrolled_baseline && !has_expired(quest, now) {
                    changes.accepted.push(quest.clone());
                }
            }
        }

        // An empty list is more likely a format change than every quest being
        // gone: forgetting everything would announce them all again later.
        if !quests.is_empty() {
            let listed: HashSet<&str> = quests.iter().map(|quest| quest.id.as_str()).collect();
            let before = memory.seen.len() + memory.warned.len() + enrolled.len();
            memory.seen.retain(|id| listed.contains(id.as_str()));
            memory.warned.retain(|id| listed.contains(id.as_str()));
            enrolled.retain(|id| listed.contains(id.as_str()));
            self.dirty |= memory.seen.len() + memory.warned.len() + enrolled.len() != before;
        }

        self.statuses = quests.iter().map(|quest| (quest.id.clone(), quest.status)).collect();
        changes
    }

    /// Writes the memory to disk if it changed since the last call.
    pub fn persist(&mut self) -> AppResult<()> {
        let Some(memory) = self.memory.as_ref().filter(|_| self.dirty) else { return Ok(()) };
        storage::write_json(&self.file, memory)?;
        self.dirty = false;
        Ok(())
    }
}

fn has_expired(quest: &Quest, now: i64) -> bool {
    quest.expires_at.is_some_and(|at| at <= now)
}

fn expires_soon(quest: &Quest, now: i64) -> bool {
    quest.expires_at.is_some_and(|at| at > now && at - now <= EXPIRY_WARNING_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000_000;
    const HOUR: i64 = 3_600_000;

    fn quest(id: &str, status: QuestStatus, expires_in: Option<i64>) -> Quest {
        Quest {
            id: id.into(),
            name: format!("Quest {id}"),
            game_title: None,
            publisher: None,
            application_id: None,
            eligible_application_ids: Vec::new(),
            any_task: false,
            reward: None,
            reward_orbs: None,
            starts_at: None,
            expires_at: expires_in.map(|delta| NOW + delta),
            tasks: Vec::new(),
            status,
            progress_seconds: None,
            completed_at: None,
            claimed_at: None,
        }
    }

    fn open(id: &str) -> Quest {
        quest(id, QuestStatus::Available, Some(100 * HOUR))
    }

    fn ids(quests: &[Quest]) -> Vec<&str> {
        quests.iter().map(|quest| quest.id.as_str()).collect()
    }

    fn tracker() -> (tempfile::TempDir, QuestTracker) {
        let dir = tempfile::tempdir().unwrap();
        let tracker = QuestTracker::load(dir.path().join("quests-seen.json")).unwrap();
        (dir, tracker)
    }

    #[test]
    fn the_first_look_only_sets_the_baseline() {
        let (_dir, mut tracker) = tracker();
        assert!(tracker.observe(&[open("a"), open("b")], NOW).is_empty());
    }

    #[test]
    fn a_quest_that_appears_later_is_new_once() {
        let (_dir, mut tracker) = tracker();
        tracker.observe(&[open("a")], NOW);

        let changes = tracker.observe(&[open("a"), open("b")], NOW);
        assert_eq!(ids(&changes.new), ["b"]);
        assert!(tracker.observe(&[open("a"), open("b")], NOW).new.is_empty());
    }

    #[test]
    fn a_new_quest_that_is_already_done_or_expired_is_not_announced() {
        let (_dir, mut tracker) = tracker();
        tracker.observe(&[open("a")], NOW);

        let done = quest("done", QuestStatus::Completed, None);
        let late = quest("late", QuestStatus::Available, Some(-HOUR));
        assert!(tracker.observe(&[open("a"), done, late], NOW).new.is_empty());
    }

    #[test]
    fn a_quest_turning_completed_is_reported_once() {
        let (_dir, mut tracker) = tracker();
        tracker.observe(&[quest("a", QuestStatus::Enrolled, None)], NOW);

        let completed = quest("a", QuestStatus::Completed, None);
        assert_eq!(ids(&tracker.observe(std::slice::from_ref(&completed), NOW).completed), ["a"]);
        assert!(tracker.observe(&[completed], NOW).completed.is_empty());
    }

    #[test]
    fn a_quest_already_completed_at_the_first_look_is_not_a_completion() {
        let (_dir, mut tracker) = tracker();
        assert!(tracker.observe(&[quest("a", QuestStatus::Completed, None)], NOW).completed.is_empty());
    }

    #[test]
    fn a_close_deadline_is_reminded_once() {
        let (_dir, mut tracker) = tracker();
        let soon = quest("a", QuestStatus::Enrolled, Some(5 * HOUR));

        // Already on the first look: the reminder is about time, not novelty.
        assert_eq!(ids(&tracker.observe(std::slice::from_ref(&soon), NOW).expiring), ["a"]);
        assert!(tracker.observe(&[soon], NOW).expiring.is_empty());
    }

    #[test]
    fn far_finished_or_past_deadlines_are_not_reminded() {
        let (_dir, mut tracker) = tracker();
        let far = quest("far", QuestStatus::Available, Some(48 * HOUR));
        let done = quest("done", QuestStatus::Completed, Some(HOUR));
        let past = quest("past", QuestStatus::Available, Some(-HOUR));
        let endless = quest("endless", QuestStatus::Available, None);

        assert!(tracker.observe(&[far, done, past, endless], NOW).expiring.is_empty());
    }

    #[test]
    fn an_empty_answer_does_not_make_everything_new_again() {
        let (_dir, mut tracker) = tracker();
        tracker.observe(&[open("a")], NOW);

        assert!(tracker.observe(&[], NOW).is_empty());
        assert!(tracker.observe(&[open("a")], NOW).new.is_empty());
    }

    #[test]
    fn what_was_seen_survives_a_restart() {
        let (dir, mut tracker) = tracker();
        tracker.observe(&[open("a")], NOW);
        tracker.persist().unwrap();

        let mut restarted = QuestTracker::load(dir.path().join("quests-seen.json")).unwrap();
        let changes = restarted.observe(&[open("a"), open("b")], NOW);
        assert_eq!(ids(&changes.new), ["b"]);
    }

    #[test]
    fn a_quest_accepted_after_the_first_look_is_reported_once() {
        let (_dir, mut tracker) = tracker();
        let already = quest("a", QuestStatus::Enrolled, None);
        assert!(tracker.observe(&[already.clone(), open("b")], NOW).accepted.is_empty(), "the baseline");

        let accepted = quest("b", QuestStatus::Enrolled, None);
        let changes = tracker.observe(&[already.clone(), accepted.clone()], NOW);
        assert_eq!(ids(&changes.accepted), ["b"]);
        assert!(tracker.observe(&[already, accepted], NOW).accepted.is_empty());
    }

    #[test]
    fn a_file_from_before_the_accepted_tracking_only_sets_its_baseline() {
        let (dir, _) = tracker();
        let file = dir.path().join("quests-seen.json");
        std::fs::write(&file, r#"{ "seen": ["a"], "warned": [] }"#).unwrap();

        let mut tracker = QuestTracker::load(file).unwrap();
        assert!(tracker.observe(&[quest("a", QuestStatus::Enrolled, None)], NOW).accepted.is_empty());
        assert_eq!(ids(&tracker.observe(&[quest("a", QuestStatus::Enrolled, None), quest("c", QuestStatus::Enrolled, None)], NOW).accepted), ["c"]);
    }

    #[test]
    fn nothing_is_written_when_nothing_changed() {
        let (dir, mut tracker) = tracker();
        tracker.observe(&[open("a")], NOW);
        tracker.persist().unwrap();
        let file = dir.path().join("quests-seen.json");
        std::fs::remove_file(&file).unwrap();

        tracker.observe(&[open("a")], NOW);
        tracker.persist().unwrap();
        assert!(!file.exists());
    }
}
