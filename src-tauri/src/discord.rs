//! What can be learned about the user's Discord client.
//!
//! * [`status`] checks that a Discord desktop client is running — game
//!   detection does not exist in a browser nor in third-party clients.
//! * [`check_detection`] answers "did Discord notice my fake game?" by reading
//!   the end of Discord's own local log. It is read-only, only looks for the
//!   game being checked, and nothing it reads is stored or sent anywhere.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{Local, NaiveDateTime, TimeZone};
use serde::Serialize;

use crate::process::scan;

/// Desktop clients that implement game detection, with their data folder.
const OFFICIAL_CLIENTS: [(&str, &str, &str); 3] = [
    ("discord.exe", "Discord", "discord"),
    ("discordptb.exe", "Discord PTB", "discordptb"),
    ("discordcanary.exe", "Discord Canary", "discordcanary"),
];

/// Alternative clients: they are Discord, but do not detect games.
const UNSUPPORTED_CLIENTS: [(&str, &str); 4] = [
    ("vesktop.exe", "Vesktop"),
    ("legcord.exe", "Legcord"),
    ("armcord.exe", "ArmCord"),
    ("webcord.exe", "WebCord"),
];

/// How much of the log's end is examined.
const LOG_TAIL_BYTES: u64 = 4 * 1024 * 1024;
/// Discord logs a few seconds before our own clock records the start.
const CLOCK_TOLERANCE_MS: i64 = 3_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordStatus {
    pub running: bool,
    /// Name of the official client found, e.g. `Discord`.
    pub client: Option<String>,
    /// A client that is running but cannot detect games.
    pub unsupported_client: Option<String>,
}

fn classify(processes: &[String]) -> DiscordStatus {
    let has = |name: &str| processes.iter().any(|process| process == name);

    let client = OFFICIAL_CLIENTS.iter().find(|(exe, ..)| has(exe)).map(|(_, label, _)| (*label).to_owned());
    let unsupported_client =
        UNSUPPORTED_CLIENTS.iter().find(|(exe, _)| has(exe)).map(|(_, label)| (*label).to_owned());

    DiscordStatus { running: client.is_some(), client, unsupported_client }
}

pub fn status() -> DiscordStatus {
    classify(&scan::running_executables())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectionState {
    /// Discord named this game (or its application id) in its log.
    Detected,
    /// Discord's list of running games changed, but nothing names our game.
    Reacted,
    /// Nothing yet: Discord scans every 15 to 60 seconds.
    Waiting,
    /// Discord's log could not be found or read.
    LogUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionReport {
    pub state: DetectionState,
    /// Unix milliseconds of the first sign of detection.
    pub detected_at: Option<i64>,
}

/// Finds the most recently written Discord renderer log.
fn locate_log() -> Option<PathBuf> {
    let appdata = PathBuf::from(std::env::var_os("APPDATA")?);

    OFFICIAL_CLIENTS
        .iter()
        .map(|(.., folder)| appdata.join(folder).join("logs").join("renderer_js.log"))
        .filter_map(|path| Some((path.metadata().ok()?.modified().ok()?, path)))
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

fn read_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(max_bytes)))?;

    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Parses the `[2026-10-20 21:13:54.914]` prefix (local time) of a log line.
fn line_timestamp(line: &str) -> Option<i64> {
    let stamp = line.strip_prefix('[')?.split(']').next()?;
    let naive = NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H:%M:%S%.3f").ok()?;
    Some(Local.from_local_datetime(&naive).earliest()?.timestamp_millis())
}

/// Looks for signs, after `since`, that Discord noticed the game.
///
/// * `game_id`: Discord's application id of the game;
/// * `exe_key`: the fake executable's full path, lower-cased with `/` separators.
fn analyze(log: &str, game_id: &str, exe_key: &str, since: i64) -> DetectionReport {
    let heartbeat = format!("for game {game_id} ");
    let mut reacted_at = None;

    for line in log.lines() {
        let Some(at) = line_timestamp(line).filter(|at| *at >= since - CLOCK_TOLERANCE_MS) else { continue };

        let lowered = line.to_lowercase();
        let names_our_game = lowered.contains(&format!("newprimarykey={exe_key}"))
            || lowered.contains(&heartbeat);
        if names_our_game {
            return DetectionReport { state: DetectionState::Detected, detected_at: Some(at) };
        }

        if reacted_at.is_none() && line.contains("[RunningGameStore] Running Games Changed") {
            reacted_at = Some(at);
        }
    }

    match reacted_at {
        Some(at) => DetectionReport { state: DetectionState::Reacted, detected_at: Some(at) },
        None => DetectionReport { state: DetectionState::Waiting, detected_at: None },
    }
}

/// A fake game to look for in Discord's log.
#[derive(Debug, Clone)]
pub struct DetectionRequest {
    pub game_id: String,
    /// The fake executable's full path.
    pub exe_path: PathBuf,
    /// When the session started, in Unix milliseconds.
    pub started_at: i64,
}

/// Reads Discord's log once and reports, for each request, whether Discord
/// noticed that fake game. The result has the same order as `requests`.
pub fn check_many(requests: &[DetectionRequest]) -> Vec<DetectionReport> {
    let log = locate_log().and_then(|path| read_tail(&path, LOG_TAIL_BYTES).ok());

    requests
        .iter()
        .map(|request| match &log {
            Some(log) => {
                let exe_key = request.exe_path.to_string_lossy().to_lowercase().replace('\\', "/");
                analyze(log, &request.game_id, &exe_key, request.started_at)
            }
            None => DetectionReport { state: DetectionState::LogUnavailable, detected_at: None },
        })
        .collect()
}

/// Reads Discord's log and reports whether it noticed one fake game.
pub fn check_detection(game_id: &str, exe_path: &Path, started_at: i64) -> DetectionReport {
    let request = DetectionRequest { game_id: game_id.to_owned(), exe_path: exe_path.to_path_buf(), started_at };
    check_many(&[request])
        .into_iter()
        .next()
        .unwrap_or(DetectionReport { state: DetectionState::LogUnavailable, detected_at: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|name| (*name).to_owned()).collect()
    }

    fn at(stamp: &str) -> i64 {
        let naive = NaiveDateTime::parse_from_str(stamp, "%Y-%m-%d %H:%M:%S%.3f").unwrap();
        Local.from_local_datetime(&naive).earliest().unwrap().timestamp_millis()
    }

    const EXE: &str = "c:/users/me/appdata/local/dev.questcompleter.app/games/356875221078245376/overwatch.exe";

    #[test]
    fn recognizes_official_clients() {
        let status = classify(&names(&["explorer.exe", "discordptb.exe"]));
        assert!(status.running);
        assert_eq!(status.client.as_deref(), Some("Discord PTB"));
    }

    #[test]
    fn reports_a_missing_client() {
        let status = classify(&names(&["explorer.exe"]));
        assert!(!status.running);
        assert_eq!(status.client, None);
    }

    #[test]
    fn flags_clients_without_game_detection() {
        let status = classify(&names(&["vesktop.exe"]));
        assert!(!status.running);
        assert_eq!(status.unsupported_client.as_deref(), Some("Vesktop"));
    }

    #[test]
    fn parses_log_timestamps_as_local_time() {
        assert_eq!(line_timestamp("[2026-10-20 21:13:54.914] [info]  x"), Some(at("2026-10-20 21:13:54.914")));
        assert_eq!(line_timestamp("no timestamp"), None);
        assert_eq!(line_timestamp("[2026-Oct-10 12:38:48.229 +02:00] other format"), None);
    }

    #[test]
    fn detects_the_game_from_the_primary_key() {
        let log = format!(
            "[2026-10-20 21:13:54.914] [info]  [RunningGameStore] Running Games Changed [object Object]\n\
             [2026-10-20 21:13:54.915] [info]  [Clips] decider: handleRunningGamesChange visibleGame=Overwatch newPrimaryKey={EXE}:Overwatch currentSessionGameKey=x\n"
        );

        let report = analyze(&log, "356875221078245376", EXE, at("2026-10-20 21:13:33.000"));
        assert_eq!(report.state, DetectionState::Detected);
        assert_eq!(report.detected_at, Some(at("2026-10-20 21:13:54.915")));
    }

    #[test]
    fn detects_the_game_from_its_application_id() {
        let log = "[2026-10-20 21:14:00.193] [warn]  [RunningGameHeartbeatManager] Failed to get performance snapshot for game 356875221078245376 Performance snapshot not available\n";
        let report = analyze(log, "356875221078245376", EXE, at("2026-10-20 21:13:33.000"));
        assert_eq!(report.state, DetectionState::Detected);
    }

    #[test]
    fn a_generic_change_is_only_a_reaction() {
        let log = "[2026-10-20 21:13:54.914] [info]  [RunningGameStore] Running Games Changed [object Object]\n";
        let report = analyze(log, "1", EXE, at("2026-10-20 21:13:33.000"));
        assert_eq!(report.state, DetectionState::Reacted);
    }

    #[test]
    fn ignores_everything_that_happened_before_the_session() {
        let log = format!(
            "[2026-10-20 20:00:00.000] [info]  [RunningGameStore] Running Games Changed [object Object]\n\
             [2026-10-20 20:00:00.100] [info]  newPrimaryKey={EXE}:Overwatch\n"
        );
        let report = analyze(&log, "356875221078245376", EXE, at("2026-10-20 21:13:33.000"));
        assert_eq!(report.state, DetectionState::Waiting);
    }

    #[test]
    fn another_game_id_does_not_match() {
        let log = "[2026-10-20 21:14:00.193] [warn]  Failed to get performance snapshot for game 3562 x\n";
        assert_eq!(analyze(log, "356", EXE, at("2026-10-20 21:13:33.000")).state, DetectionState::Waiting);
    }

    #[test]
    fn reading_a_missing_log_fails_cleanly() {
        assert!(read_tail(Path::new("definitely/not/here.log"), 1024).is_err());
    }

    #[test]
    fn only_the_tail_of_a_large_log_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("renderer_js.log");
        std::fs::write(&path, format!("{}END", "x".repeat(10_000))).unwrap();

        let tail = read_tail(&path, 100).unwrap();
        assert_eq!(tail.len(), 100);
        assert!(tail.ends_with("END"));
    }
}
