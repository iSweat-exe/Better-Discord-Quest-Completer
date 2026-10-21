//! Disk usage and cleanup of the fake executables folder.

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::games::model::is_valid_game_id;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub path: String,
    pub game_count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanReport {
    pub removed_games: usize,
    pub freed_bytes: u64,
    /// Folders left in place because a process is using them.
    pub skipped: usize,
}

/// The sub-folders of `games_dir` that belong to a game (named after its id).
fn game_folders(games_dir: &Path) -> impl Iterator<Item = (String, std::path::PathBuf)> {
    fs::read_dir(games_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| {
            let id = entry.file_name().into_string().ok()?;
            is_valid_game_id(&id).then(|| (id, entry.path()))
        })
}

/// Deletes the folder of one game. Returns whether anything was removed.
///
/// Refuses anything that is not a valid Discord application id, so a crafted
/// id can never point outside the games folder.
pub fn remove_game_folder(games_dir: &Path, game_id: &str) -> bool {
    if !is_valid_game_id(game_id) {
        return false;
    }
    fs::remove_dir_all(games_dir.join(game_id)).is_ok()
}

pub fn inspect(games_dir: &Path) -> StorageInfo {
    let (game_count, total_bytes) = game_folders(games_dir)
        .fold((0, 0), |(count, bytes), (_, folder)| (count + 1, bytes + folder_size(&folder)));

    StorageInfo { path: games_dir.display().to_string(), game_count, total_bytes }
}

/// Deletes the folders of every game that is not in `keep`.
///
/// Only folders named like a Discord application id are ever touched, so
/// anything else the user may have put there is left alone.
pub fn clean(games_dir: &Path, keep: &HashSet<String>) -> CleanReport {
    let mut report = CleanReport::default();

    for (id, folder) in game_folders(games_dir) {
        if keep.contains(&id) {
            report.skipped += 1;
            continue;
        }

        let size = folder_size(&folder);
        match fs::remove_dir_all(&folder) {
            Ok(()) => {
                report.removed_games += 1;
                report.freed_bytes += size;
            }
            Err(_) => report.skipped += 1,
        }
    }
    report
}

fn folder_size(folder: &Path) -> u64 {
    fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => folder_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map_or(0, |metadata| metadata.len()),
            _ => 0,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn populate(root: &Path) {
        fs::create_dir_all(root.join("111").join("bin")).unwrap();
        fs::write(root.join("111").join("bin").join("a.exe"), [0u8; 100]).unwrap();
        fs::create_dir_all(root.join("222")).unwrap();
        fs::write(root.join("222").join("b.exe"), [0u8; 50]).unwrap();
        // Not a game folder: must be ignored and never deleted.
        fs::create_dir_all(root.join("my-notes")).unwrap();
        fs::write(root.join("my-notes").join("keep.txt"), "important").unwrap();
    }

    #[test]
    fn inspect_counts_only_game_folders() {
        let dir = tempfile::tempdir().unwrap();
        populate(dir.path());

        let info = inspect(dir.path());
        assert_eq!(info.game_count, 2);
        assert_eq!(info.total_bytes, 150);
    }

    #[test]
    fn removes_one_game_folder_only() {
        let dir = tempfile::tempdir().unwrap();
        populate(dir.path());

        assert!(remove_game_folder(dir.path(), "111"));
        assert!(!dir.path().join("111").exists());
        assert!(dir.path().join("222").exists());
        assert!(!remove_game_folder(dir.path(), "111"), "already gone");
    }

    #[test]
    fn refuses_ids_that_could_escape_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        populate(dir.path());

        assert!(!remove_game_folder(dir.path(), ".."));
        assert!(!remove_game_folder(dir.path(), "../111"));
        assert!(!remove_game_folder(dir.path(), "my-notes"));
        assert!(dir.path().join("my-notes").join("keep.txt").exists());
    }

    #[test]
    fn inspect_handles_a_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let info = inspect(&dir.path().join("missing"));
        assert_eq!((info.game_count, info.total_bytes), (0, 0));
    }

    #[test]
    fn clean_removes_everything_except_kept_and_foreign_folders() {
        let dir = tempfile::tempdir().unwrap();
        populate(dir.path());

        let report = clean(dir.path(), &HashSet::from(["222".to_owned()]));

        assert_eq!(report, CleanReport { removed_games: 1, freed_bytes: 100, skipped: 1 });
        assert!(!dir.path().join("111").exists());
        assert!(dir.path().join("222").exists());
        assert!(dir.path().join("my-notes").join("keep.txt").exists());
    }
}
