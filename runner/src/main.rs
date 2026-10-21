//! Placeholder game process started by Discord Quest Completer.
//!
//! Discord detects a game by watching the running processes. This tiny binary
//! only opens a small window (and a tray icon) under the executable name
//! Discord expects.
//!
//! Arguments:
//! * `--title <name>`: game name shown in the window;
//! * `--lang <fr|en>`: interface language;
//! * `--window <normal|minimized|hidden>`: how the window first appears.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod cli;

#[cfg(windows)]
mod ui;

fn main() {
    let options = cli::Options::from_args(std::env::args_os().skip(1));

    #[cfg(windows)]
    ui::run(&options);

    #[cfg(not(windows))]
    {
        let _ = options;
        eprintln!("dqc-runner n'est disponible que sous Windows.");
        std::process::exit(1);
    }
}
