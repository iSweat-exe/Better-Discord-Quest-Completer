//! Export and import of the library as a small JSON document, so it can be
//! moved to another machine or restored after a reinstall.
//!
//! Only ids and names travel: everything else is looked up in the catalog on
//! import, which keeps imported games up to date and the format tiny.

use serde::{Deserialize, Serialize};

use super::library::LibraryEntry;
use super::model::is_valid_game_id;
use crate::error::{AppError, AppResult};

const FORMAT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Document {
    version: u32,
    games: Vec<Item>,
}

#[derive(Serialize, Deserialize)]
struct Item {
    id: String,
    /// Informational only: lets a human read the file.
    #[serde(default)]
    name: String,
}

pub fn export(entries: &[LibraryEntry]) -> AppResult<String> {
    let document = Document {
        version: FORMAT_VERSION,
        games: entries
            .iter()
            .map(|entry| Item { id: entry.game.id.clone(), name: entry.game.name.clone() })
            .collect(),
    };
    serde_json::to_string_pretty(&document).map_err(|error| AppError::Internal(error.to_string()))
}

/// Extracts the valid game ids of an export, in order and without duplicates.
pub fn parse(json: &str) -> AppResult<Vec<String>> {
    let document: Document = serde_json::from_str(json.trim())
        .map_err(|error| AppError::Catalog(format!("not a library export: {error}")))?;

    if document.version > FORMAT_VERSION {
        return Err(AppError::Catalog(format!("export version {} is too recent", document.version)));
    }

    let mut ids: Vec<String> = Vec::new();
    for item in document.games {
        if is_valid_game_id(&item.id) && !ids.contains(&item.id) {
            ids.push(item.id);
        }
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::games::model::Game;

    fn entry(id: &str, name: &str) -> LibraryEntry {
        LibraryEntry {
            game: Game {
                id: id.into(),
                name: name.into(),
                aliases: vec![],
                executables: vec![],
                icon_hash: None,
                themes: vec![],
            },
            added_at: 0,
            last_played_at: None,
            total_seconds: 0,
        }
    }

    #[test]
    fn an_export_can_be_imported_back() {
        let json = export(&[entry("1", "One"), entry("2", "Two")]).unwrap();
        assert_eq!(parse(&json).unwrap(), ["1", "2"]);
    }

    #[test]
    fn invalid_and_duplicate_ids_are_dropped() {
        let json = r#"{ "version": 1, "games": [
            { "id": "1" }, { "id": "1" }, { "id": "../2" }, { "id": "" }, { "id": "3", "name": "Three" }
        ] }"#;
        assert_eq!(parse(json).unwrap(), ["1", "3"]);
    }

    #[test]
    fn garbage_is_refused() {
        assert!(parse("not json").is_err());
        assert!(parse("{}").is_err());
        assert!(parse("[]").is_err());
    }

    #[test]
    fn files_from_the_future_are_refused() {
        assert!(parse(r#"{ "version": 99, "games": [] }"#).is_err());
    }

    #[test]
    fn surrounding_whitespace_is_tolerated() {
        assert_eq!(parse("  \n{ \"version\": 1, \"games\": [] }\n ").unwrap(), Vec::<String>::new());
    }
}
