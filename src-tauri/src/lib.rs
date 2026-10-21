//! Discord Quest Completer — backend.
//!
//! Layout:
//! * [`games`]: the Discord catalog, the user's library, executable validation;
//! * [`process`]: the embedded fake-game runner and the sessions that run it;
//! * [`presence`]: the experimental Rich Presence;
//! * [`commands`]: the Tauri commands exposed to the frontend.

mod commands;
mod disk;
mod discord;
mod error;
mod games;
mod http;
mod launcher;
mod lifecycle;
mod locale;
mod logger;
mod paths;
mod presence;
mod process;
mod quest_watch;
mod quests;
mod settings;
mod state;
mod stats;
mod updates;
mod storage;
mod util;

use std::sync::Arc;

use tauri::Manager;

use crate::state::{AppState, Shared};

pub fn run() {
    let app = tauri::Builder::default()
        // Must be the first plugin: a second instance would fight the first one
        // over the same files and fake processes.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            lifecycle::show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![state::MINIMIZED_ARGUMENT]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let state: Shared = Arc::new(AppState::init(app.handle())?);
            app.manage(state);

            lifecycle::setup_tray(app.handle())?;
            lifecycle::spawn_session_watcher(app.handle().clone());
            quest_watch::spawn(app.handle().clone());
            updates::spawn_checker(app.handle().clone());
            lifecycle::spawn_show_fallback(app.handle().clone());
            Ok(())
        })
        .on_window_event(lifecycle::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::get_catalog,
            commands::get_library,
            commands::add_to_library,
            commands::remove_from_library,
            commands::export_library,
            commands::import_library,
            commands::get_settings,
            commands::update_settings,
            commands::list_sessions,
            commands::start_session,
            commands::stop_session,
            commands::stop_all_sessions,
            commands::get_quests_connection,
            commands::connect_quests,
            commands::check_for_update,
            commands::get_pending_update,
            commands::install_update,
            commands::get_cached_quests,
            commands::refresh_quests,
            commands::enroll_quest,
            commands::claim_quest_reward,
            commands::watch_quest_video,
            commands::get_quest_risk,
            commands::get_quest_activity,
            commands::get_active_videos,
            commands::get_interrupted_videos,
            commands::dismiss_interrupted_videos,
            commands::get_app_stats,
            commands::get_profile,
            commands::get_orbs_balance,
            commands::get_orbs_shop,
            commands::disconnect_quests,
            commands::get_discord_status,
            commands::check_detection,
            commands::reveal_executable,
            commands::get_storage_info,
            commands::clean_storage,
            commands::open_games_folder,
            commands::get_logs,
            commands::clear_logs,
            commands::get_presence_status,
            commands::publish_presence,
            commands::clear_presence,
            commands::window_ready,
            commands::hide_to_tray,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build the Discord Quest Completer application");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            lifecycle::shutdown(handle);
        }
    });
}
