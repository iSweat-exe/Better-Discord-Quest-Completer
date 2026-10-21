//! User preferences, persisted as `settings.json`.

use std::path::PathBuf;
use std::sync::{PoisonError, RwLock};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::storage;

pub const MIN_QUEST_MINUTES: u32 = 1;
pub const MAX_QUEST_MINUTES: u32 = 480;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Language {
    #[default]
    Auto,
    Fr,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    System,
    Dark,
    Light,
}

/// How the fake game windows appear when a game starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunnerWindow {
    /// Visible, without stealing the focus.
    #[default]
    Normal,
    /// In the taskbar only.
    Minimized,
    /// Tray icon only.
    Hidden,
}

impl RunnerWindow {
    /// Value of the runner's `--window` argument.
    pub fn argument(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Minimized => "minimized",
            Self::Hidden => "hidden",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[expect(clippy::struct_excessive_bools, reason = "independent user toggles, mirrored by the frontend")]
pub struct Settings {
    pub language: Language,
    pub theme: Theme,
    /// Playtime after which the quest timer is considered complete.
    pub quest_duration_minutes: u32,
    pub notify_on_complete: bool,
    /// Announce new and soon-to-expire quests. Needs the Discord token, and is
    /// what makes the app look at the quests while no game is running.
    pub notify_new_quests: bool,
    /// Look for a newer version at startup and every few hours.
    pub auto_check_updates: bool,
    /// Keep running in the system tray when the window is closed.
    pub close_to_tray: bool,
    pub runner_window: RunnerWindow,
    /// Start the quest timer only once Discord has noticed the game.
    pub wait_for_detection: bool,
    /// Stop a game by itself once its quest timer completes.
    pub auto_stop_on_complete: bool,
    /// Start with Windows, minimized to the tray.
    pub launch_at_startup: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::default(),
            theme: Theme::default(),
            quest_duration_minutes: 15,
            notify_on_complete: true,
            notify_new_quests: true,
            auto_check_updates: true,
            close_to_tray: false,
            runner_window: RunnerWindow::default(),
            wait_for_detection: true,
            auto_stop_on_complete: false,
            launch_at_startup: false,
        }
    }
}

/// A partial update: only the provided fields change.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub language: Option<Language>,
    pub theme: Option<Theme>,
    pub quest_duration_minutes: Option<u32>,
    pub notify_on_complete: Option<bool>,
    pub notify_new_quests: Option<bool>,
    pub auto_check_updates: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub runner_window: Option<RunnerWindow>,
    pub wait_for_detection: Option<bool>,
    pub auto_stop_on_complete: Option<bool>,
    pub launch_at_startup: Option<bool>,
}

impl Settings {
    fn apply(&mut self, patch: SettingsPatch) {
        if let Some(value) = patch.language {
            self.language = value;
        }
        if let Some(value) = patch.theme {
            self.theme = value;
        }
        if let Some(value) = patch.quest_duration_minutes {
            self.quest_duration_minutes = value;
        }
        if let Some(value) = patch.notify_on_complete {
            self.notify_on_complete = value;
        }
        if let Some(value) = patch.notify_new_quests {
            self.notify_new_quests = value;
        }
        if let Some(value) = patch.auto_check_updates {
            self.auto_check_updates = value;
        }
        if let Some(value) = patch.close_to_tray {
            self.close_to_tray = value;
        }
        if let Some(value) = patch.runner_window {
            self.runner_window = value;
        }
        if let Some(value) = patch.wait_for_detection {
            self.wait_for_detection = value;
        }
        if let Some(value) = patch.auto_stop_on_complete {
            self.auto_stop_on_complete = value;
        }
        if let Some(value) = patch.launch_at_startup {
            self.launch_at_startup = value;
        }
        self.sanitize();
    }

    /// Brings hand-edited or out-of-range values back to something valid.
    fn sanitize(&mut self) {
        self.quest_duration_minutes = self.quest_duration_minutes.clamp(MIN_QUEST_MINUTES, MAX_QUEST_MINUTES);
    }
}

pub struct SettingsStore {
    file: PathBuf,
    current: RwLock<Settings>,
}

impl SettingsStore {
    pub fn load(file: PathBuf) -> AppResult<Self> {
        let mut settings: Settings = storage::read_json(&file)?.unwrap_or_default();
        settings.sanitize();
        Ok(Self { file, current: RwLock::new(settings) })
    }

    pub fn get(&self) -> Settings {
        self.current.read().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub fn update(&self, patch: SettingsPatch) -> AppResult<Settings> {
        let mut current = self.current.write().unwrap_or_else(PoisonError::into_inner);

        let mut next = current.clone();
        next.apply(patch);
        storage::write_json(&self.file, &next)?;

        *current = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patch_only_changes_provided_fields() {
        let mut settings = Settings::default();
        settings.apply(SettingsPatch { theme: Some(Theme::Dark), ..SettingsPatch::default() });

        assert_eq!(settings.theme, Theme::Dark);
        assert_eq!(settings.quest_duration_minutes, 15);
    }

    #[test]
    fn quest_duration_is_clamped() {
        let mut settings = Settings::default();

        settings.apply(SettingsPatch { quest_duration_minutes: Some(0), ..SettingsPatch::default() });
        assert_eq!(settings.quest_duration_minutes, MIN_QUEST_MINUTES);

        settings.apply(SettingsPatch { quest_duration_minutes: Some(100_000), ..SettingsPatch::default() });
        assert_eq!(settings.quest_duration_minutes, MAX_QUEST_MINUTES);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let settings: Settings = serde_json::from_str(r#"{ "theme": "light" }"#).unwrap();
        assert_eq!(settings.theme, Theme::Light);
        assert!(settings.notify_on_complete);
    }

    #[test]
    fn new_quest_notifications_are_on_by_default_and_can_be_turned_off() {
        let mut settings: Settings = serde_json::from_str("{}").unwrap();
        assert!(settings.notify_new_quests);

        settings.apply(SettingsPatch { notify_new_quests: Some(false), ..SettingsPatch::default() });
        assert!(!settings.notify_new_quests);
    }

    #[test]
    fn update_checks_are_on_by_default_and_can_be_turned_off() {
        let mut settings: Settings = serde_json::from_str("{}").unwrap();
        assert!(settings.auto_check_updates);

        settings.apply(SettingsPatch { auto_check_updates: Some(false), ..SettingsPatch::default() });
        assert!(!settings.auto_check_updates);
    }

    #[test]
    fn runner_window_modes_map_to_runner_arguments() {
        assert_eq!(RunnerWindow::Normal.argument(), "normal");
        assert_eq!(RunnerWindow::Minimized.argument(), "minimized");
        assert_eq!(RunnerWindow::Hidden.argument(), "hidden");
    }

    #[test]
    fn new_toggles_default_to_off_and_can_be_patched() {
        let mut settings = Settings::default();
        assert!(!settings.auto_stop_on_complete && !settings.launch_at_startup);
        assert!(settings.wait_for_detection, "the timer waits for Discord by default");

        settings.apply(SettingsPatch {
            auto_stop_on_complete: Some(true),
            runner_window: Some(RunnerWindow::Hidden),
            ..SettingsPatch::default()
        });
        assert!(settings.auto_stop_on_complete);
        assert_eq!(settings.runner_window, RunnerWindow::Hidden);
    }

    #[test]
    fn updates_are_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");

        let store = SettingsStore::load(file.clone()).unwrap();
        store.update(SettingsPatch { close_to_tray: Some(true), ..SettingsPatch::default() }).unwrap();

        assert!(SettingsStore::load(file).unwrap().get().close_to_tray);
    }
}
