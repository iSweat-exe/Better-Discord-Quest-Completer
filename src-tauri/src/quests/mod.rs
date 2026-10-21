//! Reading the user's Discord quests.
//!
//! Discord lists a user's quests behind an authenticated endpoint
//! (`GET /quests/@me`, `401` without credentials). Using it requires the
//! account's token, which makes this module the most sensitive part of the app.
//! It therefore sticks to a strict contract:
//!
//! * **read-only**: only `GET` requests (the quests, the Orbs balance and the
//!   account's public profile — nothing else of the account is ever read);
//!   nothing is ever accepted, started, claimed or completed through the
//!   account — quests are still completed by the fake games, exactly as before;
//! * **paced**: [`crate::quest_watch`] looks at the quests once a minute while
//!   a fake game runs, and every 20 minutes otherwise (only to announce new
//!   quests, and only if the user wants those notifications);
//! * the token only travels to `discord.com`, over HTTPS, with redirects
//!   disabled so it can never be forwarded elsewhere;
//! * see [`token`] for how the token is stored and kept out of logs.

pub mod client;
pub mod model;
pub mod token;
pub mod tracker;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::logger::AppLog;
use crate::storage;
use crate::util::{now_millis, spawn_blocking};

use self::model::{Profile, Quest, parse_orbs_balance, parse_profile, parse_quests};
use self::token::{SystemStore, Token, TokenStore};
use self::tracker::{QuestChanges, QuestTracker};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestsResponse {
    pub quests: Vec<Quest>,
    /// Unix milliseconds.
    pub fetched_at: i64,
    /// Discord's answer as received (it never contains the token): lets a
    /// format mismatch be diagnosed.
    pub raw_json: String,
}

/// A look at the quests, and what it changed since the previous one.
#[derive(Debug)]
pub struct QuestSync {
    pub response: QuestsResponse,
    pub changes: QuestChanges,
}

pub struct QuestService {
    client: reqwest::Client,
    store: Arc<dyn TokenStore>,
    log: Arc<AppLog>,
    tracker: Mutex<QuestTracker>,
    /// The last answer, kept so the quests can be shown the moment the app
    /// starts instead of after a round trip to Discord.
    cache_file: PathBuf,
    cache: Mutex<Option<QuestsResponse>>,
}

impl QuestService {
    /// `seen_file` remembers which quests were already announced, `cache_file`
    /// the last answer.
    pub fn new(log: Arc<AppLog>, seen_file: PathBuf, cache_file: PathBuf) -> AppResult<Self> {
        Self::with_parts(Arc::new(SystemStore), log, QuestTracker::load(seen_file)?, cache_file)
    }

    fn with_parts(
        store: Arc<dyn TokenStore>,
        log: Arc<AppLog>,
        tracker: QuestTracker,
        cache_file: PathBuf,
    ) -> AppResult<Self> {
        // A cache that cannot be read is just a cache that is empty.
        let cached = storage::read_json(&cache_file).ok().flatten();
        Ok(Self {
            client: client::build()?,
            store,
            log,
            tracker: Mutex::new(tracker),
            cache_file,
            cache: Mutex::new(cached),
        })
    }

    /// Whether a token is saved.
    pub async fn is_connected(&self) -> AppResult<bool> {
        let store = Arc::clone(&self.store);
        Ok(spawn_blocking(move || store.load()).await??.is_some())
    }

    /// Checks `raw` against Discord and, only if it works, saves it.
    pub async fn connect(&self, raw: &str) -> AppResult<QuestSync> {
        let token = Token::parse(raw)?;
        let sync = self.fetch(&token).await?;

        let store = Arc::clone(&self.store);
        spawn_blocking(move || store.save(&token)).await??;
        self.log.info("Discord token saved in the system credential store.");
        self.log.info(format!("{} Discord quest(s) loaded.", sync.response.quests.len()));
        Ok(sync)
    }

    /// The quests as last seen, without any request. `None` without a token, so
    /// a forgotten account never leaves its quests behind.
    pub async fn cached_quests(&self) -> AppResult<Option<QuestsResponse>> {
        if !self.is_connected().await? {
            return Ok(None);
        }
        Ok(self.cache.lock().unwrap_or_else(PoisonError::into_inner).clone())
    }

    /// Reloads the quests with the saved token.
    pub async fn refresh(&self) -> AppResult<QuestSync> {
        let token = self.saved_token().await?;
        let fetched = self.fetch(&token).await;
        self.forget_if_rejected(fetched).await
    }

    /// The account the saved token belongs to.
    pub async fn profile(&self) -> AppResult<Profile> {
        let token = self.saved_token().await?;
        let answer = client::fetch_profile(&self.client, &token).await;
        let answer = self.forget_if_rejected(answer).await?;
        parse_profile(&answer).ok_or_else(|| AppError::Network("Discord's profile answer is not understood".into()))
    }

    /// The Orbs the account holds.
    pub async fn orbs_balance(&self) -> AppResult<u64> {
        let token = self.saved_token().await?;
        let answer = client::fetch_orbs_balance(&self.client, &token).await;
        let answer = self.forget_if_rejected(answer).await?;
        parse_orbs_balance(&answer).ok_or_else(|| AppError::Network("Discord's Orbs answer is not understood".into()))
    }

    /// Forgets the token.
    pub async fn disconnect(&self) -> AppResult<()> {
        let store = Arc::clone(&self.store);
        spawn_blocking(move || store.clear()).await??;
        *self.cache.lock().unwrap_or_else(PoisonError::into_inner) = None;
        // Already gone is as good as removed.
        let _ = std::fs::remove_file(&self.cache_file);
        self.log.info("Discord token removed.");
        Ok(())
    }

    async fn saved_token(&self) -> AppResult<Token> {
        let store = Arc::clone(&self.store);
        spawn_blocking(move || store.load()).await??.ok_or(AppError::TokenMissing)
    }

    /// A token Discord refuses is useless: do not keep it around.
    async fn forget_if_rejected<T>(&self, result: AppResult<T>) -> AppResult<T> {
        if matches!(result, Err(AppError::TokenInvalid)) {
            self.disconnect().await?;
            self.log.warn("Discord rejected the saved token: it was removed.");
        }
        result
    }

    async fn fetch(&self, token: &Token) -> AppResult<QuestSync> {
        let answer = client::fetch_quests(&self.client, token).await?;
        let quests = parse_quests(&answer);
        let changes = self.observe(&quests);

        let response = QuestsResponse {
            quests,
            fetched_at: now_millis(),
            raw_json: serde_json::to_string_pretty(&answer).unwrap_or_default(),
        };
        self.remember(&response).await;
        Ok(QuestSync { response, changes })
    }

    /// Keeps `response` as the last answer; the disk is only touched when the quests themselves changed.
    async fn remember(&self, response: &QuestsResponse) {
        let changed = {
            let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
            let changed = cache.as_ref().is_none_or(|previous| previous.quests != response.quests);
            *cache = Some(response.clone());
            changed
        };
        if !changed {
            return;
        }

        let file = self.cache_file.clone();
        let snapshot = response.clone();
        match spawn_blocking(move || storage::write_json(&file, &snapshot)).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) | Err(error) => self.log.warn(format!("Could not save the quests cache: {error}")),
        }
    }

    fn observe(&self, quests: &[Quest]) -> QuestChanges {
        let mut tracker = self.tracker.lock().unwrap_or_else(PoisonError::into_inner);
        let changes = tracker.observe(quests, now_millis());
        if let Err(error) = tracker.persist() {
            self.log.warn(format!("Could not save the list of seen quests: {error}"));
        }
        changes
    }
}

#[cfg(test)]
mod tests {
    use super::token::MemoryStore;
    use super::*;

    /// The directory must outlive the service: it holds the seen-quests file.
    fn service() -> (tempfile::TempDir, QuestService) {
        let dir = tempfile::tempdir().unwrap();
        let tracker = QuestTracker::load(dir.path().join("quests-seen.json")).unwrap();
        let service = QuestService::with_parts(
            Arc::new(MemoryStore::default()),
            Arc::new(AppLog::default()),
            tracker,
            dir.path().join("quests-cache.json"),
        )
        .unwrap();
        (dir, service)
    }

    #[test]
    fn refreshing_without_a_token_is_refused_before_any_request() {
        let (_dir, service) = service();
        let error = tauri::async_runtime::block_on(service.refresh()).unwrap_err();
        assert_eq!(error.kind(), "tokenMissing");
    }

    fn sample_response() -> QuestsResponse {
        QuestsResponse { quests: Vec::new(), fetched_at: 1, raw_json: "{}".into() }
    }

    #[test]
    fn the_last_answer_is_available_at_once_and_survives_a_restart() {
        let (dir, service) = service();
        let token = Token::parse("aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccccc").unwrap();
        service.store.save(&token).unwrap();
        tauri::async_runtime::block_on(service.remember(&sample_response()));

        assert_eq!(tauri::async_runtime::block_on(service.cached_quests()).unwrap().unwrap().fetched_at, 1);

        let from_disk: Option<QuestsResponse> = storage::read_json(&dir.path().join("quests-cache.json")).unwrap();
        assert!(from_disk.is_some());
    }

    #[test]
    fn nothing_is_served_from_the_cache_without_a_token() {
        let (_dir, service) = service();
        tauri::async_runtime::block_on(service.remember(&sample_response()));
        assert!(tauri::async_runtime::block_on(service.cached_quests()).unwrap().is_none());
    }

    #[test]
    fn forgetting_the_token_wipes_the_cache_too() {
        let (dir, service) = service();
        tauri::async_runtime::block_on(service.remember(&sample_response()));

        tauri::async_runtime::block_on(service.disconnect()).unwrap();
        assert!(!dir.path().join("quests-cache.json").exists());
        assert!(service.cache.lock().unwrap().is_none());
    }

    #[test]
    fn the_orbs_balance_needs_a_token_too() {
        let (_dir, service) = service();
        let error = tauri::async_runtime::block_on(service.orbs_balance()).unwrap_err();
        assert_eq!(error.kind(), "tokenMissing");
    }

    #[test]
    fn the_profile_needs_a_token_too() {
        let (_dir, service) = service();
        let error = tauri::async_runtime::block_on(service.profile()).unwrap_err();
        assert_eq!(error.kind(), "tokenMissing");
    }

    #[test]
    fn a_malformed_token_is_refused_before_any_request() {
        let (_dir, service) = service();
        let error = tauri::async_runtime::block_on(service.connect("not a token")).unwrap_err();
        assert_eq!(error.kind(), "tokenFormat");
    }

    #[test]
    fn a_fresh_service_is_not_connected() {
        let (_dir, service) = service();
        assert!(!tauri::async_runtime::block_on(service.is_connected()).unwrap());
    }

    #[test]
    fn disconnecting_is_harmless_when_nothing_is_saved() {
        let (_dir, service) = service();
        tauri::async_runtime::block_on(service.disconnect()).unwrap();
    }

    #[test]
    fn a_rejected_token_is_forgotten_but_other_failures_keep_it() {
        let (_dir, service) = service();
        let token = Token::parse("aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccccc").unwrap();
        service.store.save(&token).unwrap();

        let network = tauri::async_runtime::block_on(service.forget_if_rejected::<()>(Err(AppError::Network("x".into()))));
        assert_eq!(network.unwrap_err().kind(), "network");
        assert!(tauri::async_runtime::block_on(service.is_connected()).unwrap());

        let rejected = tauri::async_runtime::block_on(service.forget_if_rejected::<()>(Err(AppError::TokenInvalid)));
        assert_eq!(rejected.unwrap_err().kind(), "tokenInvalid");
        assert!(!tauri::async_runtime::block_on(service.is_connected()).unwrap());
    }
}
