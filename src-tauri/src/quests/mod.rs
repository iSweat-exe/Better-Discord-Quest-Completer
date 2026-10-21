//! Reading the user's Discord quests.
//!
//! Discord lists a user's quests behind an authenticated endpoint
//! (`GET /quests/@me`, `401` without credentials). Using it requires the
//! account's token, which makes this module the most sensitive part of the app.
//! It therefore sticks to a strict contract:
//!
//! * **reads** with `GET` (the quests, the Orbs balance, the Orbs shop and the
//!   account's public profile — nothing else of the account is ever read);
//! * **writes** only on a click of the user, on one quest: accepting it,
//!   claiming its reward, or reporting the progress of its video. Nothing is
//!   written in the background; "play" quests are still completed by the fake games;
//! * **paced**: [`crate::quest_watch`] looks at the quests once a minute while
//!   a fake game runs, and every 20 minutes otherwise (only to announce new
//!   quests, and only if the user wants those notifications);
//! * the token only travels to `discord.com`, over HTTPS, with redirects
//!   disabled so it can never be forwarded elsewhere;
//! * see [`token`] for how the token is stored and kept out of logs.

pub mod client;
pub mod model;
pub mod risk;
pub mod shop;
pub mod token;
pub mod tracker;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::logger::AppLog;
use crate::storage;
use crate::util::{now_millis, spawn_blocking};

use self::model::{Profile, Quest, parse_orbs_balance, parse_profile, parse_quests};
use self::risk::{ActivityEntry, RiskLog, RiskReport, WriteKind};
use self::shop::{ShopResponse, read_shop};
use self::token::{SystemStore, Token, TokenStore};
use self::tracker::{QuestChanges, QuestTracker};

/// Video progress is reported one second at a time, once a second, like a player would.
const VIDEO_STEP_SECONDS: u64 = 1;
const VIDEO_LEAD_SECONDS: u64 = 10;
/// Bounds the loop of [`QuestService::watch_video`] (about an hour).
const VIDEO_MAX_REPORTS: u32 = 3600;

/// For a quest of `answer` that was accepted and asks to watch a video: the
/// seconds to watch, the seconds already watched, and when it was accepted (Unix ms).
fn video_plan(answer: &serde_json::Value, quest_id: &str) -> Option<(u64, u64, i64)> {
    let quest = parse_quests(answer).into_iter().find(|quest| quest.id == quest_id)?;
    let target = quest
        .tasks
        .iter()
        .find(|task| matches!(task.kind, model::TaskKind::WatchVideo | model::TaskKind::WatchVideoOnMobile))?
        .target_seconds;
    let raw = answer.get("quests")?.as_array()?.iter().find(|raw| raw.get("id").is_some_and(|id| id.as_str() == Some(quest_id)))?;
    let status = raw.get("user_status").or_else(|| raw.get("userStatus"))?;
    let enrolled = status.get("enrolled_at").or_else(|| status.get("enrolledAt"))?.as_str()?;
    let enrolled_at = chrono::DateTime::parse_from_rfc3339(enrolled).ok()?.timestamp_millis();
    Some((target, quest.progress_seconds.unwrap_or(0), enrolled_at))
}

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
    /// The writes made on the account, for the suspicion indicator.
    risk: Mutex<RiskLog>,
    /// Videos being watched right now: seconds reported, seconds to watch.
    active_videos: Mutex<HashMap<String, (u64, u64)>>,
    /// Videos that were being watched when the app was closed: ids Discord may resume.
    interrupted_videos: Mutex<Vec<String>>,
    video_file: PathBuf,
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
        let video_file = cache_file.with_file_name("quests-video-watch.json");
        Ok(Self {
            client: client::build()?,
            store,
            log,
            tracker: Mutex::new(tracker),
            cache: Mutex::new(cached),
            risk: Mutex::new(RiskLog::load(cache_file.with_file_name("quests-activity.json"))),
            active_videos: Mutex::new(HashMap::new()),
            interrupted_videos: Mutex::new(storage::read_json(&video_file).ok().flatten().unwrap_or_default()),
            video_file,
            cache_file,
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

    /// What the Orbs shop sells.
    pub async fn orbs_shop(&self) -> AppResult<ShopResponse> {
        let token = self.saved_token().await?;
        let answer = client::fetch_orbs_shop(&self.client, &token).await;
        let answer = self.forget_if_rejected(answer).await?;
        Ok(read_shop(&answer))
    }

    /// Accepts a quest, then reloads the quests.
    pub async fn enroll(&self, quest_id: &str) -> AppResult<QuestSync> {
        let token = self.saved_token().await?;
        let done = client::enroll_quest(&self.client, &token, quest_id).await;
        self.forget_if_rejected(done).await?;
        self.log.warn(format!("Account write: quest {quest_id} accepted on the user's request."));
        self.record_write(WriteKind::Enroll, quest_id);
        self.refresh().await
    }

    /// Claims the reward of a completed quest, then reloads the quests.
    pub async fn claim_reward(&self, quest_id: &str) -> AppResult<QuestSync> {
        let token = self.saved_token().await?;
        let done = client::claim_quest_reward(&self.client, &token, quest_id).await;
        self.forget_if_rejected(done).await?;
        self.log.warn(format!("Account write: reward of quest {quest_id} claimed on the user's request."));
        self.record_write(WriteKind::Claim, quest_id);
        self.refresh().await
    }

    /// Reports the progress of a video quest until Discord marks it completed,
    /// pacing the reports the way the video player would (Discord refuses a
    /// progress that is ahead of the time since the quest was accepted).
    /// `on_progress(done, target)` is called with the seconds watched so far, after each report.
    pub async fn watch_video(&self, quest_id: &str, on_progress: impl Fn(u64, u64)) -> AppResult<QuestSync> {
        let token = self.saved_token().await?;
        let answer = client::fetch_quests(&self.client, &token).await;
        let answer = self.forget_if_rejected(answer).await?;
        let (target, mut done, enrolled_at) = video_plan(&answer, quest_id)
            .ok_or_else(|| AppError::Network("This quest has no video to watch, or was not accepted yet".into()))?;

        self.log.warn(format!("Account write: reporting the video progress of quest {quest_id} ({target} s) on the user's request."));
        self.record_write(WriteKind::Video, quest_id);
        for _ in 0..VIDEO_MAX_REPORTS {
            let allowed = u64::try_from(now_millis().saturating_sub(enrolled_at) / 1000).unwrap_or(0) + VIDEO_LEAD_SECONDS;
            if done + VIDEO_STEP_SECONDS <= allowed || done >= target {
                done = (done + VIDEO_STEP_SECONDS).min(target);
                let reply = client::post_video_progress(&self.client, &token, quest_id, done).await;
                let reply = self.forget_if_rejected(reply).await?;
                on_progress(done, target);
                if reply.get("completed_at").is_some_and(|value| !value.is_null()) || done >= target {
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
        self.refresh().await
    }

    /// How suspicious the recent writes on the account look.
    pub fn risk(&self) -> RiskReport {
        self.risk.lock().unwrap_or_else(PoisonError::into_inner).assess(now_millis())
    }

    /// The writes made on the account, newest first.
    pub fn activity(&self) -> Vec<ActivityEntry> {
        self.risk.lock().unwrap_or_else(PoisonError::into_inner).history(now_millis())
    }

    /// The name of a quest of the last answer (its id when it is unknown).
    pub fn quest_name(&self, quest_id: &str) -> String {
        let cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        cache
            .as_ref()
            .and_then(|response| response.quests.iter().find(|quest| quest.id == quest_id))
            .map_or_else(|| quest_id.to_owned(), |quest| quest.name.clone())
    }

    fn record_write(&self, kind: WriteKind, quest_id: &str) {
        let name = self.quest_name(quest_id);
        if let Err(error) = self.risk.lock().unwrap_or_else(PoisonError::into_inner).record(kind, &name, now_millis()) {
            self.log.warn(format!("Could not save the write history: {error}"));
        }
    }

    /// Marks a video as being watched. `false` when it already is.
    pub fn begin_video(&self, quest_id: &str) -> bool {
        {
            let mut active = self.active_videos.lock().unwrap_or_else(PoisonError::into_inner);
            if active.contains_key(quest_id) {
                return false;
            }
            active.insert(quest_id.to_owned(), (0, 0));
        }
        self.interrupted_videos.lock().unwrap_or_else(PoisonError::into_inner).retain(|id| id != quest_id);
        self.persist_videos();
        true
    }

    pub fn set_video_progress(&self, quest_id: &str, done: u64, target: u64) {
        self.active_videos.lock().unwrap_or_else(PoisonError::into_inner).insert(quest_id.to_owned(), (done, target));
    }

    pub fn end_video(&self, quest_id: &str) {
        self.active_videos.lock().unwrap_or_else(PoisonError::into_inner).remove(quest_id);
        self.persist_videos();
    }

    /// Videos being watched: quest id, seconds reported, seconds to watch.
    pub fn active_videos(&self) -> Vec<(String, u64, u64)> {
        let active = self.active_videos.lock().unwrap_or_else(PoisonError::into_inner);
        active.iter().map(|(id, (done, target))| (id.clone(), *done, *target)).collect()
    }

    /// Videos that were being watched when the app last closed.
    pub fn interrupted_videos(&self) -> Vec<String> {
        self.interrupted_videos.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    pub fn dismiss_interrupted_videos(&self) {
        self.interrupted_videos.lock().unwrap_or_else(PoisonError::into_inner).clear();
        self.persist_videos();
    }

    /// What is on disk: the videos being watched, and the interrupted ones not dealt with yet.
    fn persist_videos(&self) {
        let mut ids: Vec<String> = self.active_videos.lock().unwrap_or_else(PoisonError::into_inner).keys().cloned().collect();
        ids.extend(self.interrupted_videos.lock().unwrap_or_else(PoisonError::into_inner).iter().cloned());
        if let Err(error) = storage::write_json(&self.video_file, &ids) {
            self.log.warn(format!("Could not save the videos being watched: {error}"));
        }
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
    fn the_shop_needs_a_token_too() {
        let (_dir, service) = service();
        let error = tauri::async_runtime::block_on(service.orbs_shop()).unwrap_err();
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
