//! One-click checks of everything game detection depends on.
//!
//! Each check answers with an id and a status; the UI words them. Details carry
//! raw values (a client name, an error) with the user's profile folder replaced
//! by `%USERPROFILE%`, so the report can be pasted in a public issue.

use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::discord;
use crate::games::catalog::CatalogSource;
use crate::process::runner;
use crate::state::AppState;
use crate::util::{now_millis, spawn_blocking};

/// How long a fresh copy of the runner must survive for the antivirus check.
const QUARANTINE_WAIT: Duration = Duration::from_millis(1500);
/// A Discord log untouched for this long while Discord runs is suspicious.
const STALE_LOG_MS: i64 = 24 * 3_600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckStatus {
    Ok,
    Warning,
    Error,
    Info,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// Identifies the check (and its texts in the UI).
    pub id: &'static str,
    pub status: CheckStatus,
    /// A value worth showing: a version, a client name, an error message…
    pub detail: Option<String>,
    /// A moment worth showing (Unix ms), e.g. when Discord last wrote its log.
    pub at: Option<i64>,
}

fn check(id: &'static str, status: CheckStatus, detail: Option<String>) -> Check {
    Check { id, status, detail, at: None }
}

/// Replaces the user's profile folder, which holds their Windows user name.
fn redact(text: &str) -> String {
    match std::env::var("USERPROFILE") {
        Ok(profile) if !profile.is_empty() => {
            let lower = text.to_lowercase();
            let needle = profile.to_lowercase();
            match lower.find(&needle) {
                // Lower-casing kept the length (ASCII user names): replace in place.
                Some(start) if lower.len() == text.len() => {
                    format!("{}%USERPROFILE%{}", &text[..start], &text[start + needle.len()..])
                }
                _ => text.replace(&profile, "%USERPROFILE%"),
            }
        }
        _ => text.to_owned(),
    }
}

/// Writes then removes a file in `dir`: the folder exists and can be written to.
fn writable(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let probe = dir.join(".dqc-write-check");
    std::fs::write(&probe, b"ok").map_err(|error| error.to_string())?;
    std::fs::remove_file(&probe).map_err(|error| error.to_string())
}

/// Copies the runner like a launch would, waits, and checks it is still there,
/// unchanged: an antivirus that quarantines it would make every launch fail.
fn runner_survives(games_dir: &Path) -> Result<(), String> {
    let dir = games_dir.join("_check");
    let file = dir.join("dqc-check.exe");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let result = runner::install(&file).map_err(|error| error.to_string()).and_then(|_| {
        std::thread::sleep(QUARANTINE_WAIT);
        match std::fs::metadata(&file) {
            Ok(meta) if usize::try_from(meta.len()).ok() == Some(runner::size()) => Ok(()),
            Ok(_) => Err("altered".to_owned()),
            Err(_) => Err("removed".to_owned()),
        }
    });
    let _ = std::fs::remove_dir_all(&dir);
    result
}

pub async fn run(app: &AppHandle, state: &AppState) -> Vec<Check> {
    let mut checks = vec![check(
        "app",
        CheckStatus::Info,
        Some(format!("{} · {} {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH)),
    )];

    // Data folder and fake games.
    let root = state.paths.root().to_path_buf();
    let games_dir = state.paths.games_dir();
    let (data, runner_check) = spawn_blocking(move || (writable(&root), runner::is_available().then(|| runner_survives(&games_dir))))
        .await
        .unwrap_or_else(|error| (Err(error.to_string()), Some(Err("check failed".to_owned()))));
    checks.push(match data {
        Ok(()) => check("dataDir", CheckStatus::Ok, Some(redact(&state.paths.root().display().to_string()))),
        Err(error) => check("dataDir", CheckStatus::Error, Some(redact(&error))),
    });
    checks.push(match runner_check {
        None => check("runner", CheckStatus::Error, None),
        Some(Ok(())) => check("runner", CheckStatus::Ok, None),
        Some(Err(error)) => check("runner", CheckStatus::Error, Some(redact(&error))),
    });
    checks.push(check("jobObject", if state.sessions.has_job() { CheckStatus::Ok } else { CheckStatus::Warning }, None));

    // Discord itself.
    let status = spawn_blocking(discord::status).await.ok();
    checks.push(match status {
        Some(status) if status.running => check("discordClient", CheckStatus::Ok, status.client),
        Some(status) if status.unsupported_client.is_some() => {
            check("discordClient", CheckStatus::Error, status.unsupported_client)
        }
        _ => check("discordClient", CheckStatus::Warning, None),
    });
    let discord_running = status_running(&checks);

    let log = spawn_blocking(|| discord::log_info().map(|(path, modified)| (discord::log_readable(&path), modified)))
        .await
        .ok()
        .flatten();
    checks.push(match log {
        None => check("discordLog", CheckStatus::Warning, None),
        Some((false, _)) => check("discordLog", CheckStatus::Error, None),
        Some((true, modified)) => {
            let untouched = discord_running && modified.is_some_and(|at| now_millis() - at > STALE_LOG_MS);
            Check { at: modified, ..check("discordLog", if untouched { CheckStatus::Warning } else { CheckStatus::Ok }, None) }
        }
    });

    let games_dir = state.paths.games_dir();
    let primary = spawn_blocking(move || discord::primary_game(&games_dir)).await.ok().flatten();
    checks.push(match primary {
        Some(primary) => Check { at: Some(primary.at), ..check("primaryGame", CheckStatus::Info, Some(primary.name)) },
        None => check("primaryGame", CheckStatus::Info, None),
    });

    // The game list.
    checks.push(match state.catalog.current() {
        None => check("catalog", CheckStatus::Warning, None),
        Some(catalog) => {
            let level = if catalog.refresh_error.is_some() || catalog.source == CatalogSource::Bundled {
                CheckStatus::Warning
            } else {
                CheckStatus::Ok
            };
            Check {
                at: catalog.fetched_at,
                ..check("catalog", level, Some(catalog.games.len().to_string()))
            }
        }
    });

    // The optional token, and the startup entry.
    checks.push(match state.quests.is_connected().await {
        Ok(true) => check("token", CheckStatus::Ok, None),
        Ok(false) => check("token", CheckStatus::Info, None),
        Err(error) => check("token", CheckStatus::Error, Some(error.to_string())),
    });
    let wanted = state.settings.get().launch_at_startup;
    checks.push(match app.autolaunch().is_enabled() {
        Ok(enabled) if enabled == wanted => check("autostart", CheckStatus::Ok, Some(enabled.to_string())),
        Ok(enabled) => check("autostart", CheckStatus::Warning, Some(enabled.to_string())),
        Err(error) => check("autostart", CheckStatus::Warning, Some(error.to_string())),
    });

    checks
}

fn status_running(checks: &[Check]) -> bool {
    checks.iter().any(|check| check.id == "discordClient" && check.status == CheckStatus::Ok)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_folder_is_redacted() {
        let Ok(profile) = std::env::var("USERPROFILE") else { return };
        let path = format!("{profile}\\AppData\\Local\\dev.questcompleter.app");
        let redacted = redact(&path);
        assert!(!redacted.contains(&profile), "{redacted}");
        assert!(redacted.starts_with("%USERPROFILE%"));
        assert_eq!(redact("no path here"), "no path here");
    }

    #[test]
    fn a_writable_folder_passes_and_leaves_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(writable(dir.path()).is_ok());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
