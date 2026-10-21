//! The user's saved games, persisted across restarts.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};

use super::model::{CURRENT_PLATFORM, Game};
use crate::error::AppResult;
use crate::storage;
use crate::util::now_millis;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    /// Snapshot of the catalog entry, so the library keeps working offline.
    pub game: Game,
    pub added_at: i64,
    /// When the game was last started, in Unix milliseconds.
    #[serde(default)]
    pub last_played_at: Option<i64>,
    /// Total simulated playtime, in seconds.
    #[serde(default)]
    pub total_seconds: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct LibraryFile {
    entries: Vec<LibraryEntry>,
}

pub struct Library {
    file: PathBuf,
    entries: Mutex<Vec<LibraryEntry>>,
}

impl Library {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let mut stored: LibraryFile = storage::read_json(&file)?.unwrap_or_default();
        for entry in &mut stored.entries {
            entry.game.annotate(CURRENT_PLATFORM);
        }

        Ok(Self { file, entries: Mutex::new(stored.entries) })
    }

    pub fn entries(&self) -> Vec<LibraryEntry> {
        self.lock().clone()
    }

    pub fn get(&self, id: &str) -> Option<Game> {
        self.lock().iter().find(|entry| entry.game.id == id).map(|entry| entry.game.clone())
    }

    /// Adds `game` unless it is already saved. Returns the updated library.
    pub fn add(&self, game: Game) -> AppResult<Vec<LibraryEntry>> {
        let mut entries = self.lock();
        if entries.iter().all(|entry| entry.game.id != game.id) {
            entries.push(LibraryEntry { game, added_at: now_millis(), last_played_at: None, total_seconds: 0 });
            self.save(&entries)?;
        }
        Ok(entries.clone())
    }

    pub fn remove(&self, id: &str) -> AppResult<Vec<LibraryEntry>> {
        let mut entries = self.lock();
        let before = entries.len();
        entries.retain(|entry| entry.game.id != id);
        if entries.len() != before {
            self.save(&entries)?;
        }
        Ok(entries.clone())
    }

    /// Accounts for a finished session of `game_id`. Unknown games are ignored.
    pub fn record_session(&self, game_id: &str, started_at: i64, ended_at: i64) -> AppResult<()> {
        let mut entries = self.lock();
        let Some(entry) = entries.iter_mut().find(|entry| entry.game.id == game_id) else { return Ok(()) };

        entry.last_played_at = Some(started_at);
        entry.total_seconds += u64::try_from((ended_at - started_at).max(0) / 1000).unwrap_or(0);
        self.save(&entries)
    }

    /// Refreshes the saved snapshots with newer catalog data.
    ///
    /// Returns `true` when something changed.
    pub fn sync_with(&self, catalog: &[Game]) -> AppResult<bool> {
        let fresh: HashMap<&str, &Game> = catalog.iter().map(|game| (game.id.as_str(), game)).collect();

        let mut entries = self.lock();
        let mut changed = false;
        for entry in entries.iter_mut() {
            if let Some(&latest) = fresh.get(entry.game.id.as_str())
                && entry.game != *latest
            {
                entry.game = latest.clone();
                changed = true;
            }
        }

        if changed {
            self.save(&entries)?;
        }
        Ok(changed)
    }

    fn save(&self, entries: &[LibraryEntry]) -> AppResult<()> {
        // Borrowed serialization avoids cloning the whole library on each write.
        #[derive(Serialize)]
        struct Borrowed<'a> {
            entries: &'a [LibraryEntry],
        }
        storage::write_json(&self.file, &Borrowed { entries })
    }

    fn lock(&self) -> MutexGuard<'_, Vec<LibraryEntry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game(id: &str, name: &str) -> Game {
        Game {
            id: id.into(),
            name: name.into(),
            aliases: vec![],
            executables: vec![],
            icon_hash: None,
            themes: vec![],
        }
    }

    fn library() -> (tempfile::TempDir, Library) {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::load(dir.path().join("library.json")).unwrap();
        (dir, library)
    }

    #[test]
    fn adding_the_same_game_twice_keeps_one_entry() {
        let (_dir, library) = library();
        library.add(game("1", "One")).unwrap();
        let entries = library.add(game("1", "One")).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn entries_survive_a_reload() {
        let (dir, library) = library();
        library.add(game("1", "One")).unwrap();
        library.add(game("2", "Two")).unwrap();

        let reloaded = Library::load(dir.path().join("library.json")).unwrap();
        let names: Vec<_> = reloaded.entries().into_iter().map(|entry| entry.game.name).collect();
        assert_eq!(names, ["One", "Two"]);
    }

    #[test]
    fn removing_an_unknown_game_is_a_no_op() {
        let (_dir, library) = library();
        library.add(game("1", "One")).unwrap();
        assert_eq!(library.remove("2").unwrap().len(), 1);
        assert!(library.remove("1").unwrap().is_empty());
    }

    #[test]
    fn sessions_accumulate_playtime() {
        let (dir, library) = library();
        library.add(game("1", "One")).unwrap();

        library.record_session("1", 1_000, 61_000).unwrap();
        library.record_session("1", 100_000, 130_500).unwrap();
        library.record_session("unknown", 0, 1_000_000).unwrap();

        let entry = library.entries().remove(0);
        assert_eq!(entry.total_seconds, 90);
        assert_eq!(entry.last_played_at, Some(100_000));

        let reloaded = Library::load(dir.path().join("library.json")).unwrap();
        assert_eq!(reloaded.entries()[0].total_seconds, 90);
    }

    #[test]
    fn a_clock_going_backwards_never_subtracts_time() {
        let (_dir, library) = library();
        library.add(game("1", "One")).unwrap();
        library.record_session("1", 5_000, 1_000).unwrap();
        assert_eq!(library.entries()[0].total_seconds, 0);
    }

    #[test]
    fn old_library_files_without_stats_still_load() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("library.json");
        std::fs::write(&file, r#"{ "entries": [{ "game": { "id": "1", "name": "One" }, "addedAt": 5 }] }"#).unwrap();

        let entry = Library::load(file).unwrap().entries().remove(0);
        assert_eq!((entry.total_seconds, entry.last_played_at), (0, None));
    }

    #[test]
    fn sync_updates_saved_snapshots() {
        let (_dir, library) = library();
        library.add(game("1", "Old name")).unwrap();

        let changed = library.sync_with(&[game("1", "New name"), game("2", "Other")]).unwrap();

        assert!(changed);
        assert_eq!(library.get("1").unwrap().name, "New name");
        assert!(library.get("2").is_none());
        assert!(!library.sync_with(&[game("1", "New name")]).unwrap());
    }
}
