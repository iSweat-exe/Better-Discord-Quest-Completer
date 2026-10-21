//! The placeholder executable, embedded in the app at build time.

use std::fs;
use std::io;
use std::path::Path;

/// Built by `build.rs` from the `runner` crate (empty on unsupported platforms).
static RUNNER: &[u8] = include_bytes!(env!("DQC_RUNNER_PATH"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Installed {
    Created,
    Updated,
    Unchanged,
    /// The file exists but is locked by a running process; it is reused as is.
    InUse,
}

pub fn is_available() -> bool {
    !RUNNER.is_empty()
}

/// Makes sure a copy of the runner exists at `destination`.
///
/// The parent folder must already exist.
pub fn install(destination: &Path) -> io::Result<Installed> {
    install_bytes(destination, RUNNER)
}

fn install_bytes(destination: &Path, bytes: &[u8]) -> io::Result<Installed> {
    let existed = match fs::read(destination) {
        Ok(current) if current == bytes => return Ok(Installed::Unchanged),
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        // Unreadable (e.g. locked): fall through and let the write decide.
        Err(_) => destination.exists(),
    };

    match fs::write(destination, bytes) {
        Ok(()) if existed => Ok(Installed::Updated),
        Ok(()) => Ok(Installed::Created),
        // An older runner still holds the file: keep using it rather than failing.
        Err(_) if existed => Ok(Installed::InUse),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_then_reuses_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("game.exe");

        assert_eq!(install_bytes(&file, b"runner").unwrap(), Installed::Created);
        assert_eq!(install_bytes(&file, b"runner").unwrap(), Installed::Unchanged);
    }

    #[test]
    fn replaces_an_outdated_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("game.exe");
        fs::write(&file, b"old").unwrap();

        assert_eq!(install_bytes(&file, b"new").unwrap(), Installed::Updated);
        assert_eq!(fs::read(&file).unwrap(), b"new");
    }

    #[test]
    fn fails_when_the_folder_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(install_bytes(&dir.path().join("missing").join("game.exe"), b"x").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn the_runner_is_embedded_on_windows() {
        assert!(is_available());
        assert!(RUNNER.starts_with(b"MZ"));
    }
}
