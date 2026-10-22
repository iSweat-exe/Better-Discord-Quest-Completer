//! Analyse des arguments de ligne de commande du runner.

use std::ffi::OsString;
use std::path::PathBuf;

const DEFAULT_TITLE: &str = "Discord Quest Completer";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Lang {
    #[default]
    En,
    Fr,
}

/// How the window is shown at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WindowMode {
    /// Visible, without taking the focus from what the user is doing.
    #[default]
    Normal,
    /// Only a taskbar button.
    Minimized,
    /// Only the tray icon.
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub title: String,
    pub lang: Lang,
    pub window: WindowMode,
    /// `.ico` file of the game's icon (one image per size), used for the taskbar button and the tray icon.
    pub icon: Option<PathBuf>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            title: DEFAULT_TITLE.to_owned(),
            lang: Lang::default(),
            window: WindowMode::default(),
            icon: None,
        }
    }
}

impl Options {
    /// Unknown arguments are ignored: the runner must never refuse to start,
    /// or Discord would not detect the game.
    pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Self {
        let mut options = Self::default();
        let mut args = args.into_iter();

        while let Some(arg) = args.next() {
            match arg.to_str() {
                Some("--title") => {
                    if let Some(value) = args.next() {
                        let title = value.to_string_lossy().trim().to_owned();
                        if !title.is_empty() {
                            options.title = title;
                        }
                    }
                }
                Some("--lang") => {
                    if let Some(value) = args.next() {
                        options.lang = match value.to_str() {
                            Some(lang) if lang.eq_ignore_ascii_case("fr") => Lang::Fr,
                            _ => Lang::En,
                        };
                    }
                }
                Some("--window") => {
                    if let Some(value) = args.next() {
                        options.window = match value.to_str() {
                            Some(mode) if mode.eq_ignore_ascii_case("minimized") => WindowMode::Minimized,
                            Some(mode) if mode.eq_ignore_ascii_case("hidden") => WindowMode::Hidden,
                            _ => WindowMode::Normal,
                        };
                    }
                }
                Some("--icon") => {
                    if let Some(value) = args.next() {
                        options.icon = Some(PathBuf::from(value));
                    }
                }
                // Legacy spelling of `--window hidden`.
                Some("--hidden") => options.window = WindowMode::Hidden,
                _ => {}
            }
        }

        options
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Options {
        Options::from_args(args.iter().map(OsString::from))
    }

    #[test]
    fn defaults_are_used_without_arguments() {
        assert_eq!(parse(&[]), Options::default());
    }

    #[test]
    fn title_is_read_and_trimmed() {
        assert_eq!(parse(&["--title", "  Overwatch  "]).title, "Overwatch");
    }

    #[test]
    fn blank_title_keeps_the_default() {
        assert_eq!(parse(&["--title", "   "]).title, DEFAULT_TITLE);
    }

    #[test]
    fn dangling_title_flag_is_ignored() {
        assert_eq!(parse(&["--title"]).title, DEFAULT_TITLE);
    }

    #[test]
    fn language_and_legacy_hidden_flag_are_parsed() {
        let options = parse(&["--lang", "FR", "--hidden"]);
        assert_eq!(options.lang, Lang::Fr);
        assert_eq!(options.window, WindowMode::Hidden);
    }

    #[test]
    fn window_modes_are_parsed() {
        assert_eq!(parse(&["--window", "minimized"]).window, WindowMode::Minimized);
        assert_eq!(parse(&["--window", "HIDDEN"]).window, WindowMode::Hidden);
        assert_eq!(parse(&["--window", "normal"]).window, WindowMode::Normal);
    }

    #[test]
    fn unknown_window_modes_fall_back_to_normal() {
        assert_eq!(parse(&["--window", "fullscreen"]).window, WindowMode::Normal);
        assert_eq!(parse(&["--window"]).window, WindowMode::Normal);
    }

    #[test]
    fn icon_path_is_read_and_optional() {
        assert_eq!(parse(&["--icon", "icons/game.ico"]).icon, Some(PathBuf::from("icons/game.ico")));
        assert_eq!(parse(&["--icon"]).icon, None);
        assert_eq!(parse(&[]).icon, None);
    }

    #[test]
    fn unknown_arguments_are_ignored() {
        assert_eq!(parse(&["--nope", "--title", "X"]).title, "X");
    }
}
