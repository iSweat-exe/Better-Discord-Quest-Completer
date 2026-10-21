//! Small JSON persistence helpers.
//!
//! Writes go through a temporary file followed by a rename, so a crash or a
//! power loss can never leave a half-written file behind.

use std::fs;
use std::io;
use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};

/// Reads and deserializes `path`.
///
/// Returns `Ok(None)` when the file does not exist. A file that exists but can
/// not be parsed is moved aside (`<name>.corrupt`) and reported as `Ok(None)`
/// so the app can start from defaults instead of failing forever.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<Option<T>> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::io("reading a data file")(error)),
    };

    if let Ok(value) = serde_json::from_slice(&bytes) {
        Ok(Some(value))
    } else {
        let _ = fs::rename(path, path.with_extension("corrupt"));
        Ok(None)
    }
}

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| AppError::Internal(format!("serializing a data file: {error}")))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::io("creating the data folder"))?;
    }

    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(AppError::io("writing a data file"))?;
    fs::rename(&temporary, path).map_err(AppError::io("replacing a data file"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Sample {
        value: u32,
    }

    #[test]
    fn round_trips_a_value() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("sample.json");

        write_json(&path, &Sample { value: 7 }).unwrap();

        assert_eq!(read_json::<Sample>(&path).unwrap(), Some(Sample { value: 7 }));
    }

    #[test]
    fn missing_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_json::<Sample>(&dir.path().join("nope.json")).unwrap(), None);
    }

    #[test]
    fn corrupt_file_is_moved_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.json");
        fs::write(&path, "{ not json").unwrap();

        assert_eq!(read_json::<Sample>(&path).unwrap(), None);
        assert!(!path.exists());
        assert!(dir.path().join("sample.corrupt").exists());
    }

    #[test]
    fn overwriting_replaces_the_previous_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sample.json");

        write_json(&path, &Sample { value: 1 }).unwrap();
        write_json(&path, &Sample { value: 2 }).unwrap();

        assert_eq!(read_json::<Sample>(&path).unwrap(), Some(Sample { value: 2 }));
        assert!(!path.with_extension("tmp").exists());
    }
}
