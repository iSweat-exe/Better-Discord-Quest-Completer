//! Turns "play this executable of this game" into a running fake process.

use std::ffi::OsString;
use std::path::PathBuf;
use std::time::Duration;

use crate::error::{AppError, AppResult};
use crate::games::executable::ExecutablePath;
use crate::games::icon;
use crate::games::model::{CURRENT_PLATFORM, Game, is_valid_game_id};
use crate::locale::Lang;
use crate::process::runner;
use crate::process::sessions::{LaunchSpec, SessionInfo};
use crate::settings::{MAX_QUEST_MINUTES, MIN_QUEST_MINUTES};
use crate::state::AppState;
use crate::util::spawn_blocking;

/// Looks a game up in the library first (it works offline), then in the catalog.
pub fn find_game(state: &AppState, game_id: &str) -> AppResult<Game> {
    if !is_valid_game_id(game_id) {
        return Err(AppError::InvalidGameId(game_id.to_owned()));
    }
    state
        .library
        .get(game_id)
        .or_else(|| state.catalog.find(game_id))
        .ok_or_else(|| AppError::GameNotFound(game_id.to_owned()))
}

/// Where the fake executable of `executable_name` lives on disk.
///
/// Validates the name, so the result is always below the game's own folder.
pub fn executable_location(
    state: &AppState,
    game: &Game,
    executable_name: &str,
) -> AppResult<(ExecutablePath, PathBuf)> {
    let executable = game
        .executable(executable_name)
        .filter(|executable| executable.os == CURRENT_PLATFORM)
        .ok_or_else(|| AppError::ExecutableUnavailable(executable_name.to_owned()))?;

    let invalid = |reason| AppError::InvalidExecutable { name: executable.name.clone(), reason };
    let path = ExecutablePath::parse(&executable.name).map_err(invalid)?;
    let program = path.resolve(&state.paths.games_dir().join(&game.id)).map_err(invalid)?;
    Ok((path, program))
}

/// Starts a fake game. `target_minutes` overrides the quest timer length for
/// this session (e.g. a quest asking for 30 minutes); `None` uses the setting.
pub async fn start_session(
    state: &AppState,
    game_id: &str,
    executable_name: &str,
    target_minutes: Option<u32>,
) -> AppResult<SessionInfo> {
    if !runner::is_available() {
        return Err(AppError::UnsupportedPlatform);
    }

    let game = find_game(state, game_id)?;
    let (path, program) = executable_location(state, &game, executable_name)?;

    let install_target = program.clone();
    let installed = spawn_blocking(move || {
        if let Some(parent) = install_target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        runner::install(&install_target)
    })
    .await?
    .map_err(AppError::io("creating the fake executable"))?;
    state.log.info(format!("{}: fake executable {installed:?} ({}).", game.name, path.file_name()));

    let settings = state.settings.get();
    let mut args: Vec<OsString> = vec![
        "--title".into(),
        game.name.clone().into(),
        "--lang".into(),
        Lang::resolve(settings.language).code().into(),
        "--window".into(),
        settings.runner_window.argument().into(),
    ];

    // The taskbar button shows the game, not this app. A game without an icon keeps the runner's.
    match icon::ensure(&state.paths.root().join("game-icons"), &game).await {
        Ok(Some(file)) => {
            args.push("--icon".into());
            args.push(file.into_os_string());
        }
        Ok(None) => {}
        Err(error) => state.log.warn(format!("{}: could not get the game icon: {error}", game.name)),
    }

    let minutes = target_minutes
        .map_or(settings.quest_duration_minutes, |requested| requested.clamp(MIN_QUEST_MINUTES, MAX_QUEST_MINUTES));

    let working_dir = program.parent().map(std::path::Path::to_path_buf).unwrap_or_default();
    let session = state.sessions.start(LaunchSpec {
        id: format!("{}:{}", game.id, path.key()),
        game_id: game.id.clone(),
        game_name: game.name.clone(),
        executable: executable_name.to_owned(),
        program,
        args,
        working_dir,
        target: Duration::from_secs(u64::from(minutes) * 60),
        await_detection: settings.wait_for_detection,
    })?;

    state.log.info(format!("{} started as {} (pid {}).", game.name, path.file_name(), session.pid));
    Ok(session)
}
