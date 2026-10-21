//! How suspicious the writes on the account look.
//!
//! Every write (accepting a quest, claiming a reward, reporting a video) is
//! remembered for a day. The more of them, and the closer together, the higher
//! the level: it is only an indicator for the user, nothing is ever blocked.
//! The writes of the last month are kept, so the user can see what made it rise.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage;

const WINDOW_MS: i64 = 24 * 3_600_000;
/// How long a write stays in the history (the score only counts the last day).
const HISTORY_MS: i64 = 30 * WINDOW_MS;
const HISTORY_MAX: usize = 300;
const BURST_WINDOW_MS: i64 = 10 * 60_000;
/// Writes allowed in a burst window before each further one adds to the score.
const BURST_FREE: usize = 2;
const BURST_PENALTY: u32 = 3;
const MEDIUM_FROM: u32 = 8;
const HIGH_FROM: u32 = 16;

/// What a write weighs: watching a video is a long run of requests, the others are a single one.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WriteKind {
    #[default]
    Enroll,
    Claim,
    Video,
}

impl WriteKind {
    fn weight(self) -> u32 {
        match self {
            Self::Enroll | Self::Claim => 1,
            Self::Video => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskReport {
    pub level: RiskLevel,
    pub score: u32,
    /// Writes in the last 24 hours.
    pub writes: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct Entry {
    /// Unix milliseconds.
    at: i64,
    weight: u32,
    kind: WriteKind,
    quest_name: String,
}

/// One line of the history, for the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEntry {
    pub at: i64,
    pub kind: WriteKind,
    pub quest_name: String,
    pub weight: u32,
    /// Still counted in the level (made in the last 24 hours).
    pub counted: bool,
}

pub struct RiskLog {
    file: PathBuf,
    entries: Vec<Entry>,
}

impl RiskLog {
    /// A file that cannot be read is just a history that is empty.
    pub fn load(file: PathBuf) -> Self {
        let entries = storage::read_json(&file).ok().flatten().unwrap_or_default();
        Self { file, entries }
    }

    pub fn record(&mut self, kind: WriteKind, quest_name: &str, now: i64) -> AppResult<()> {
        self.entries.retain(|entry| now - entry.at < HISTORY_MS);
        self.entries.push(Entry { at: now, weight: kind.weight(), kind, quest_name: quest_name.to_owned() });
        if self.entries.len() > HISTORY_MAX {
            self.entries.drain(..self.entries.len() - HISTORY_MAX);
        }
        storage::write_json(&self.file, &self.entries)
    }

    /// The writes of the last month, newest first.
    pub fn history(&self, now: i64) -> Vec<ActivityEntry> {
        self.entries
            .iter()
            .rev()
            .filter(|entry| now - entry.at < HISTORY_MS)
            .map(|entry| ActivityEntry {
                at: entry.at,
                kind: entry.kind,
                quest_name: entry.quest_name.clone(),
                weight: entry.weight,
                counted: now - entry.at < WINDOW_MS,
            })
            .collect()
    }

    pub fn assess(&self, now: i64) -> RiskReport {
        let recent: Vec<&Entry> = self.entries.iter().filter(|entry| now - entry.at < WINDOW_MS).collect();
        let burst = recent.iter().filter(|entry| now - entry.at < BURST_WINDOW_MS).count();
        let score = recent.iter().map(|entry| entry.weight).sum::<u32>()
            + u32::try_from(burst.saturating_sub(BURST_FREE)).unwrap_or(u32::MAX) * BURST_PENALTY;
        let level = if score >= HIGH_FROM {
            RiskLevel::High
        } else if score >= MEDIUM_FROM {
            RiskLevel::Medium
        } else {
            RiskLevel::Low
        };
        RiskReport { level, score, writes: u32::try_from(recent.len()).unwrap_or(u32::MAX) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log() -> (tempfile::TempDir, RiskLog) {
        let dir = tempfile::tempdir().unwrap();
        let log = RiskLog::load(dir.path().join("activity.json"));
        (dir, log)
    }

    #[test]
    fn a_quiet_account_is_low() {
        let (_dir, log) = log();
        assert_eq!(log.assess(0).level, RiskLevel::Low);
    }

    #[test]
    fn spread_out_writes_stay_low_but_a_burst_climbs() {
        let (_dir, mut spread) = log();
        for hour in 0..4 {
            spread.record(WriteKind::Video, "Quest", hour * 3_600_000).unwrap();
        }
        assert_eq!(spread.assess(4 * 3_600_000).level, RiskLevel::Medium);

        let (_dir, mut burst) = log();
        for second in 0..6 {
            burst.record(WriteKind::Enroll, "Quest", second * 1000).unwrap();
        }
        assert_eq!(burst.assess(6000).score, 6 + 4 * BURST_PENALTY);
        assert_eq!(burst.assess(6000).level, RiskLevel::High);
    }

    #[test]
    fn old_writes_are_forgotten_and_the_history_survives_a_restart() {
        let (dir, mut log) = log();
        log.record(WriteKind::Claim, "Quest", 0).unwrap();
        assert_eq!(RiskLog::load(dir.path().join("activity.json")).assess(1).writes, 1);
        assert_eq!(log.assess(WINDOW_MS + 1).writes, 0);
    }

    #[test]
    fn the_history_lists_the_latest_first_and_tells_what_still_counts() {
        let (_dir, mut log) = log();
        log.record(WriteKind::Enroll, "Old", 0).unwrap();
        log.record(WriteKind::Video, "New", 2 * WINDOW_MS).unwrap();

        let history = log.history(2 * WINDOW_MS + 1);
        assert_eq!(history.iter().map(|entry| entry.quest_name.as_str()).collect::<Vec<_>>(), ["New", "Old"]);
        assert_eq!(history.iter().map(|entry| entry.counted).collect::<Vec<_>>(), [true, false]);
        assert!(log.history(2 * WINDOW_MS + HISTORY_MS).is_empty());
    }
}
