//! Validation of executable names coming from Discord's catalog.
//!
//! Names such as `bin/Win64/Game.exe` end up joined to a folder on the user's
//! disk, so they are untrusted input: a name like `..\..\evil.exe` must never
//! be able to escape the games folder.

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Characters Windows refuses in file names (path separators are split first).
const FORBIDDEN_CHARACTERS: [char; 7] = ['<', '>', ':', '"', '|', '?', '*'];
const RESERVED_DEVICE_NAMES: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
const MAX_SEGMENT_LENGTH: usize = 255;
/// Windows `MAX_PATH` minus the terminating NUL.
const MAX_PATH_LENGTH: usize = 259;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PathRejection {
    Empty,
    EmptySegment,
    Traversal,
    IllegalCharacter,
    TrailingDotOrSpace,
    ReservedName,
    TooLong,
    NotAnExe,
}

impl fmt::Display for PathRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Empty => "the name is empty",
            Self::EmptySegment => "the path contains an empty segment",
            Self::Traversal => "the path tries to leave its folder",
            Self::IllegalCharacter => "the path contains a character Windows does not allow",
            Self::TrailingDotOrSpace => "a path segment ends with a dot or a space",
            Self::ReservedName => "a path segment is a reserved device name",
            Self::TooLong => "the path is too long",
            Self::NotAnExe => "the file is not an .exe",
        })
    }
}

/// A relative executable path that is safe to create below any base folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutablePath {
    segments: Vec<String>,
}

impl ExecutablePath {
    pub fn parse(name: &str) -> Result<Self, PathRejection> {
        let name = name.trim();
        if name.is_empty() {
            return Err(PathRejection::Empty);
        }

        let segments = name
            .split(['/', '\\'])
            .map(|segment| validate_segment(segment).map(|()| segment.to_owned()))
            .collect::<Result<Vec<_>, _>>()?;

        let file_name = segments.last().map_or("", String::as_str);
        let is_exe = file_name.len() > ".exe".len() && file_name.to_ascii_lowercase().ends_with(".exe");
        if !is_exe {
            return Err(PathRejection::NotAnExe);
        }

        Ok(Self { segments })
    }

    pub fn file_name(&self) -> &str {
        self.segments.last().map_or("", String::as_str)
    }

    /// Case-insensitive identity (Windows file systems ignore case).
    pub fn key(&self) -> String {
        self.segments.join("/").to_lowercase()
    }

    /// Joins the path below `base`, refusing results Windows could not open.
    pub fn resolve(&self, base: &Path) -> Result<PathBuf, PathRejection> {
        let full = self.segments.iter().fold(base.to_path_buf(), |path, segment| path.join(segment));
        if full.as_os_str().len() > MAX_PATH_LENGTH {
            return Err(PathRejection::TooLong);
        }
        Ok(full)
    }
}

fn validate_segment(segment: &str) -> Result<(), PathRejection> {
    if segment.is_empty() {
        return Err(PathRejection::EmptySegment);
    }
    if segment == "." || segment == ".." {
        return Err(PathRejection::Traversal);
    }
    if segment.len() > MAX_SEGMENT_LENGTH {
        return Err(PathRejection::TooLong);
    }
    if segment.chars().any(|c| c.is_control() || FORBIDDEN_CHARACTERS.contains(&c)) {
        return Err(PathRejection::IllegalCharacter);
    }
    if segment.ends_with(['.', ' ']) {
        return Err(PathRejection::TrailingDotOrSpace);
    }
    if is_reserved_device_name(segment) {
        return Err(PathRejection::ReservedName);
    }
    Ok(())
}

/// `CON`, `nul.txt`, `COM1`… are device names whatever their extension.
fn is_reserved_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment).to_ascii_uppercase();

    if RESERVED_DEVICE_NAMES.contains(&stem.as_str()) {
        return true;
    }

    ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix)
            .is_some_and(|rest| rest.len() == 1 && rest.chars().all(|c| c.is_ascii_digit()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(name: &str) -> Result<ExecutablePath, PathRejection> {
        ExecutablePath::parse(name)
    }

    #[test]
    fn accepts_a_bare_executable() {
        assert_eq!(parse("overwatch.exe").unwrap().file_name(), "overwatch.exe");
    }

    #[test]
    fn accepts_nested_paths_with_either_separator() {
        assert_eq!(parse("bin/Win64/Game.exe").unwrap().key(), "bin/win64/game.exe");
        assert_eq!(parse("bin\\Win64\\Game.exe").unwrap().key(), "bin/win64/game.exe");
    }

    #[test]
    fn accepts_double_dots_inside_a_name() {
        // Real entries from Discord's catalog.
        assert!(parse("missedmessageswindows/missed messages..exe").is_ok());
        assert!(parse("oh...sir! the insult simulator/ohsir.exe").is_ok());
    }

    #[test]
    fn rejects_parent_directory_traversal() {
        assert_eq!(parse("../evil.exe"), Err(PathRejection::Traversal));
        assert_eq!(parse("game/../../evil.exe"), Err(PathRejection::Traversal));
        assert_eq!(parse("..\\evil.exe"), Err(PathRejection::Traversal));
        assert_eq!(parse("./game.exe"), Err(PathRejection::Traversal));
    }

    #[test]
    fn rejects_absolute_paths() {
        assert_eq!(parse("/etc/game.exe"), Err(PathRejection::EmptySegment));
        assert_eq!(parse("\\\\server\\share\\game.exe"), Err(PathRejection::EmptySegment));
        assert_eq!(parse("C:\\Windows\\game.exe"), Err(PathRejection::IllegalCharacter));
    }

    #[test]
    fn rejects_discord_anchored_names() {
        assert_eq!(parse(">hl2.exe"), Err(PathRejection::IllegalCharacter));
    }

    #[test]
    fn rejects_reserved_device_names() {
        assert_eq!(parse("con.exe"), Err(PathRejection::ReservedName));
        assert_eq!(parse("bin/NUL.exe"), Err(PathRejection::ReservedName));
        assert_eq!(parse("com1.exe"), Err(PathRejection::ReservedName));
        assert!(parse("com10.exe").is_ok());
        assert!(parse("console.exe").is_ok());
    }

    #[test]
    fn rejects_trailing_dots_and_spaces() {
        assert_eq!(parse("game /run.exe"), Err(PathRejection::TrailingDotOrSpace));
        assert_eq!(parse("game./run.exe"), Err(PathRejection::TrailingDotOrSpace));
    }

    #[test]
    fn rejects_empty_and_non_exe_names() {
        assert_eq!(parse("   "), Err(PathRejection::Empty));
        assert_eq!(parse("a//b.exe"), Err(PathRejection::EmptySegment));
        assert_eq!(parse("gameguard.des"), Err(PathRejection::NotAnExe));
        assert_eq!(parse(".exe"), Err(PathRejection::NotAnExe));
    }

    #[test]
    fn resolve_stays_below_the_base_directory() {
        let base = Path::new("base");
        let resolved = parse("bin/game.exe").unwrap().resolve(base).unwrap();
        assert!(resolved.starts_with(base));
        assert_eq!(resolved, base.join("bin").join("game.exe"));
    }

    #[test]
    fn resolve_rejects_paths_beyond_max_path() {
        let long_base = PathBuf::from("x".repeat(255));
        assert_eq!(parse("game.exe").unwrap().resolve(&long_base), Err(PathRejection::TooLong));
    }
}
