//! Application updates.
//!
//! Releases are published on GitHub by the `release` workflow, which signs every
//! installer with the project's private key (kept out of the repository, see the
//! README) and uploads a `latest.json` next to it. The app only trusts an update
//! whose signature matches the public key written in `tauri.conf.json`, so a
//! tampered download is refused whatever server it comes from.
//!
//! The flow is: [`UpdateService::check`] finds a newer release and keeps it,
//! the user reads what changed, then [`UpdateService::install`] downloads it
//! (reporting its progress), runs the installer and the app restarts.

use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::error::{AppError, AppResult};
use crate::state::{EVENT_UPDATE_AVAILABLE, Shared};

/// Gives the window time to settle before the first request.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

/// What the user needs to decide whether to update.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// The release notes, as written on the release.
    pub notes: Option<String>,
    /// Unix milliseconds.
    pub published_at: Option<i64>,
}

impl From<&Update> for UpdateInfo {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
            published_at: update.date.map(|date| date.unix_timestamp() * 1000),
        }
    }
}

/// How far a download is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    /// Unknown when the server does not announce the size.
    pub total: Option<u64>,
}

/// Lets a progress report through only when it moved the bar by a visible step,
/// so a download made of thousands of chunks does not flood the UI.
#[derive(Debug, Default)]
pub struct ProgressThrottle {
    downloaded: u64,
    last_percent: Option<u64>,
}

impl ProgressThrottle {
    /// Adds `chunk` bytes; returns the progress to report, if it is worth reporting.
    pub fn advance(&mut self, chunk: usize, total: Option<u64>) -> Option<DownloadProgress> {
        self.downloaded += chunk as u64;
        let progress = DownloadProgress { downloaded: self.downloaded, total };

        let percent = total.filter(|total| *total > 0).map(|total| self.downloaded.saturating_mul(100) / total);
        match (percent, self.last_percent) {
            // The size is unknown: one report per megabyte is enough.
            (None, _) => self.downloaded.is_multiple_of(1 << 20).then_some(progress),
            (Some(now), Some(before)) if now == before => None,
            (Some(now), _) => {
                self.last_percent = Some(now);
                Some(progress)
            }
        }
    }
}

struct Pending {
    update: Update,
    info: UpdateInfo,
}

#[derive(Default)]
pub struct UpdateService {
    pending: Mutex<Option<Pending>>,
}

impl UpdateService {
    /// Looks for a newer release. Remembers it (or forgets the previous one).
    pub async fn check(&self, app: &AppHandle) -> AppResult<Option<UpdateInfo>> {
        let updater = app.updater().map_err(update_error)?;
        let found = updater.check().await.map_err(update_error)?;

        let pending = found.map(|update| {
            let info = UpdateInfo::from(&update);
            Pending { update, info }
        });
        let info = pending.as_ref().map(|pending| pending.info.clone());
        *self.lock() = pending;
        Ok(info)
    }

    /// The update found by the last check, if any.
    pub fn pending_info(&self) -> Option<UpdateInfo> {
        self.lock().as_ref().map(|pending| pending.info.clone())
    }

    /// Downloads and installs the update found by the last check.
    ///
    /// On Windows the installer takes over and the app quits before this returns.
    pub async fn install(&self, mut on_progress: impl FnMut(DownloadProgress)) -> AppResult<()> {
        let update = self
            .lock()
            .as_ref()
            .map(|pending| pending.update.clone())
            .ok_or_else(|| AppError::Update("no update is waiting to be installed".into()))?;

        let mut throttle = ProgressThrottle::default();
        update
            .download_and_install(
                |chunk, total| {
                    if let Some(progress) = throttle.advance(chunk, total) {
                        on_progress(progress);
                    }
                },
                || {},
            )
            .await
            .map_err(update_error)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Pending>> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn update_error(error: tauri_plugin_updater::Error) -> AppError {
    AppError::Update(error.to_string())
}

/// Checks for updates shortly after startup, then every few hours, and tells the
/// UI when one is found. Skipped in development builds, which run unsigned code
/// that an installer would replace.
pub fn spawn_checker(app: AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;

        let mut failing = false;
        loop {
            let state = app.state::<Shared>();
            if state.settings.get().auto_check_updates {
                match state.updates.check(&app).await {
                    Ok(Some(info)) => {
                        failing = false;
                        state.log.info(format!("Update {} is available.", info.version));
                        let _ = app.emit(EVENT_UPDATE_AVAILABLE, info);
                    }
                    Ok(None) => failing = false,
                    Err(error) => {
                        // Once per outage: being offline is not worth a line every six hours.
                        if !failing {
                            state.log.warn(format!("Could not check for updates: {error}"));
                        }
                        failing = true;
                    }
                }
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: usize = 1 << 20;

    #[test]
    fn a_new_service_has_no_pending_update() {
        assert_eq!(UpdateService::default().pending_info(), None);
    }

    #[test]
    fn installing_without_a_check_is_refused() {
        let error = tauri::async_runtime::block_on(UpdateService::default().install(|_| {})).unwrap_err();
        assert_eq!(error.kind(), "update");
    }

    #[test]
    fn every_percent_is_reported_once() {
        let mut throttle = ProgressThrottle::default();
        let total = Some(10_000_u64);

        let reported = (0..100).filter(|_| throttle.advance(100, total).is_some()).count();
        assert_eq!(reported, 100);
    }

    #[test]
    fn chunks_that_do_not_move_the_bar_report_nothing() {
        let mut throttle = ProgressThrottle::default();
        let total = Some(1_000_000_u64);
        assert!(throttle.advance(1, total).is_some(), "the first chunk starts the bar");

        let reported = (0..1000).filter(|_| throttle.advance(1, total).is_some()).count();
        assert_eq!(reported, 0, "1 001 bytes of 1 000 000 is still 0 %");
    }

    #[test]
    fn the_downloaded_total_keeps_growing() {
        let mut throttle = ProgressThrottle::default();
        throttle.advance(500, Some(1000));
        let progress = throttle.advance(500, Some(1000)).unwrap();
        assert_eq!(progress.downloaded, 1000);
    }

    #[test]
    fn an_unknown_size_reports_per_megabyte() {
        let mut throttle = ProgressThrottle::default();
        assert!(throttle.advance(MB / 2, None).is_none());
        assert!(throttle.advance(MB / 2, None).is_some());
    }
}
