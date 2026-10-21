//! Data model shared with the frontend.
//!
//! `Game` mirrors an entry of Discord's `applications/detectable` endpoint.
//! Fields are read tolerantly (missing or `null` lists, `snake_case` aliases) and
//! always written in `camelCase`.

use serde::{Deserialize, Deserializer, Serialize};

use super::executable::{ExecutablePath, PathRejection};

/// Discord's name for the platform this build runs on.
pub const CURRENT_PLATFORM: &str = if cfg!(windows) {
    "win32"
} else if cfg!(target_os = "macos") {
    "darwin"
} else {
    "linux"
};

/// Discord application ids are snowflakes, which do not fit in a `JavaScript`
/// number: they are strings everywhere.
pub fn is_valid_game_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 20 && id.bytes().all(|byte| byte.is_ascii_digit())
}

/// Whether an executable can be turned into a fake process on this platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Support {
    #[default]
    Ok,
    OtherPlatform,
    InvalidPath,
    NotExe,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Executable {
    pub name: String,
    pub os: String,
    #[serde(default, alias = "is_launcher", deserialize_with = "null_as_default")]
    pub is_launcher: bool,
    /// Computed by [`Game::annotate`], never read from a file.
    #[serde(default, skip_deserializing)]
    pub support: Support,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub aliases: Vec<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub executables: Vec<Executable>,
    #[serde(default, alias = "icon_hash")]
    pub icon_hash: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub themes: Vec<String>,
}

impl Game {
    /// Fills in [`Executable::support`] for `platform`.
    pub fn annotate(&mut self, platform: &str) {
        for executable in &mut self.executables {
            executable.support = if executable.os == platform {
                match ExecutablePath::parse(&executable.name) {
                    Ok(_) => Support::Ok,
                    Err(PathRejection::NotAnExe) => Support::NotExe,
                    Err(_) => Support::InvalidPath,
                }
            } else {
                Support::OtherPlatform
            };
        }
    }

    pub fn executable(&self, name: &str) -> Option<&Executable> {
        self.executables.iter().find(|executable| executable.name == name)
    }
}

fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_snowflake_ids_only() {
        assert!(is_valid_game_id("356875221078245376"));
        assert!(!is_valid_game_id(""));
        assert!(!is_valid_game_id("../1"));
        assert!(!is_valid_game_id("12a"));
        assert!(!is_valid_game_id(&"1".repeat(21)));
    }

    #[test]
    fn reads_discord_entries_with_snake_case_and_nulls() {
        let game: Game = serde_json::from_str(
            r#"{
                "id": "1", "name": "Game", "aliases": null, "themes": null,
                "icon_hash": "abc",
                "executables": [{ "name": "game.exe", "os": "win32", "is_launcher": true, "arguments": "-x" }]
            }"#,
        )
        .unwrap();

        assert_eq!(game.icon_hash.as_deref(), Some("abc"));
        assert!(game.aliases.is_empty());
        assert!(game.executables[0].is_launcher);
    }

    #[test]
    fn reads_minimal_entries() {
        let game: Game = serde_json::from_str(r#"{ "id": "1", "name": "Game" }"#).unwrap();
        assert!(game.executables.is_empty());
        assert_eq!(game.icon_hash, None);
    }

    #[test]
    fn serializes_in_camel_case() {
        let game: Game = serde_json::from_str(
            r#"{ "id": "1", "name": "G", "icon_hash": "x", "executables": [{ "name": "g.exe", "os": "win32" }] }"#,
        )
        .unwrap();

        let json = serde_json::to_value(&game).unwrap();
        assert_eq!(json["iconHash"], "x");
        assert_eq!(json["executables"][0]["isLauncher"], false);
        assert_eq!(json["executables"][0]["support"], "ok");
    }

    #[test]
    fn annotates_each_kind_of_support() {
        let mut game = Game {
            id: "1".into(),
            name: "G".into(),
            aliases: vec![],
            themes: vec![],
            icon_hash: None,
            executables: [
                ("game.exe", "win32"),
                ("game", "linux"),
                (">hl2.exe", "win32"),
                ("data.dat", "win32"),
            ]
            .map(|(name, os)| Executable {
                name: name.into(),
                os: os.into(),
                is_launcher: false,
                support: Support::Ok,
            })
            .into(),
        };

        game.annotate("win32");

        let supports: Vec<_> = game.executables.iter().map(|executable| executable.support).collect();
        assert_eq!(
            supports,
            [Support::Ok, Support::OtherPlatform, Support::InvalidPath, Support::NotExe]
        );
    }
}
