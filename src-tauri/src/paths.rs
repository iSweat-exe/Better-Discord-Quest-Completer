//! Locations of everything the app persists on disk.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct AppPaths {
    root: PathBuf,
}

impl AppPaths {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Folder holding one sub-folder per game, each containing its fake executables.
    pub fn games_dir(&self) -> PathBuf {
        self.root.join("games")
    }

    pub fn settings_file(&self) -> PathBuf {
        self.root.join("settings.json")
    }

    pub fn library_file(&self) -> PathBuf {
        self.root.join("library.json")
    }

    pub fn catalog_cache_file(&self) -> PathBuf {
        self.root.join("catalog-cache.json")
    }

    /// What the app helped complete (see `stats`).
    pub fn stats_file(&self) -> PathBuf {
        self.root.join("stats.json")
    }

    /// The last answer of the quests endpoint (see `quests::QuestService`).
    pub fn quests_cache_file(&self) -> PathBuf {
        self.root.join("quests-cache.json")
    }

    /// Ids of the quests already announced (see `quests::tracker`).
    pub fn quests_seen_file(&self) -> PathBuf {
        self.root.join("quests-seen.json")
    }
}
