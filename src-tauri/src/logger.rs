//! In-memory activity log, mirrored to the frontend through `app-log` events.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::util::now_millis;

const CAPACITY: usize = 500;
const EVENT: &str = "app-log";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: u64,
    pub timestamp: i64,
    pub level: Level,
    pub message: String,
}

#[derive(Default)]
pub struct AppLog {
    entries: Mutex<VecDeque<LogEntry>>,
    next_id: AtomicU64,
    app: OnceLock<AppHandle>,
}

impl AppLog {
    /// Starts forwarding new entries to the frontend.
    pub fn attach(&self, app: AppHandle) {
        let _ = self.app.set(app);
    }

    pub fn info(&self, message: impl Into<String>) {
        self.push(Level::Info, message.into());
    }

    pub fn warn(&self, message: impl Into<String>) {
        self.push(Level::Warning, message.into());
    }

    pub fn error(&self, message: impl Into<String>) {
        self.push(Level::Error, message.into());
    }

    pub fn snapshot(&self) -> Vec<LogEntry> {
        self.lock().iter().cloned().collect()
    }

    pub fn clear(&self) {
        self.lock().clear();
    }

    fn push(&self, level: Level, message: String) {
        let entry = LogEntry {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            timestamp: now_millis(),
            level,
            message,
        };

        {
            let mut entries = self.lock();
            if entries.len() == CAPACITY {
                entries.pop_front();
            }
            entries.push_back(entry.clone());
        }

        if let Some(app) = self.app.get() {
            let _ = app.emit(EVENT, entry);
        }
    }

    fn lock(&self) -> MutexGuard<'_, VecDeque<LogEntry>> {
        // A poisoned log is still perfectly usable.
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_entries_in_order_with_increasing_ids() {
        let log = AppLog::default();
        log.info("first");
        log.error("second");

        let entries = log.snapshot();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].message, "first");
        assert_eq!(entries[1].level, Level::Error);
        assert!(entries[1].id > entries[0].id);
    }

    #[test]
    fn drops_the_oldest_entries_past_capacity() {
        let log = AppLog::default();
        for index in 0..CAPACITY + 10 {
            log.info(format!("entry {index}"));
        }

        let entries = log.snapshot();
        assert_eq!(entries.len(), CAPACITY);
        assert_eq!(entries[0].message, "entry 10");
    }

    #[test]
    fn clear_empties_the_log() {
        let log = AppLog::default();
        log.warn("something");
        log.clear();
        assert!(log.snapshot().is_empty());
    }
}
