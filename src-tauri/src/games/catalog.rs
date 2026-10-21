//! The catalog of games Discord can detect.
//!
//! Sources, in order of preference:
//! 1. Discord's public `applications/detectable` endpoint;
//! 2. the last successful download, cached on disk;
//! 3. a snapshot embedded in the executable (works fully offline).
//!
//! A cached download younger than [`CACHE_TTL_MS`] is used without hitting the
//! network.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};

use serde::de::IgnoredAny;
use serde::{Deserialize, Serialize};

use super::model::{CURRENT_PLATFORM, Game, is_valid_game_id};
use crate::error::{AppError, AppResult};
use crate::logger::AppLog;
use crate::storage;
use crate::util::{now_millis, spawn_blocking};

const DETECTABLE_URL: &str = "https://discord.com/api/v10/applications/detectable";
const CACHE_TTL_MS: i64 = 24 * 60 * 60 * 1000;
const BUNDLED_SNAPSHOT: &[u8] = include_bytes!("../../assets/gamelist.min.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CatalogSource {
    Discord,
    Cache,
    Bundled,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub games: Vec<Game>,
    pub source: CatalogSource,
    /// When the data was downloaded; unknown for the bundled snapshot.
    pub fetched_at: Option<i64>,
    /// Why a refresh was not possible, when the data is not the freshest.
    pub refresh_error: Option<String>,
    pub platform: &'static str,
}

impl Catalog {
    fn is_fresh(&self) -> bool {
        self.refresh_error.is_none()
            && self.source != CatalogSource::Bundled
            && self.fetched_at.is_some_and(|at| now_millis() - at < CACHE_TTL_MS)
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    fetched_at: i64,
    games: Vec<Game>,
}

pub struct CatalogService {
    client: reqwest::Client,
    cache_file: PathBuf,
    log: Arc<AppLog>,
    current: RwLock<Option<Arc<Catalog>>>,
    /// Serializes loads so concurrent callers share a single download.
    load_lock: tokio::sync::Mutex<()>,
    /// A download started in the background is under way.
    refreshing: AtomicBool,
}

impl CatalogService {
    pub fn new(cache_file: PathBuf, log: Arc<AppLog>) -> AppResult<Self> {
        let client = crate::http::public_client(crate::http::DOWNLOAD_TIMEOUT)?;

        Ok(Self {
            client,
            cache_file,
            log,
            current: RwLock::new(None),
            load_lock: tokio::sync::Mutex::new(()),
            refreshing: AtomicBool::new(false),
        })
    }

    /// The catalog loaded so far, if any.
    pub fn current(&self) -> Option<Arc<Catalog>> {
        self.current.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    pub fn find(&self, id: &str) -> Option<Game> {
        self.current()?.games.iter().find(|game| game.id == id).cloned()
    }

    /// What can be shown right now, without waiting for the network: the catalog
    /// in memory, else the cached download whatever its age, else the snapshot
    /// built into the executable. The flag tells whether a download from Discord
    /// is due, which the caller can then run in the background.
    pub async fn load_local(&self) -> AppResult<(Arc<Catalog>, bool)> {
        let known = |catalog: Arc<Catalog>| {
            let stale = !catalog.is_fresh();
            (catalog, stale)
        };
        if let Some(current) = self.current() {
            return Ok(known(current));
        }

        // Only the very first call gets here, and the lock keeps concurrent first calls from reading twice.
        let _guard = self.load_lock.lock().await;
        if let Some(current) = self.current() {
            return Ok(known(current));
        }

        let catalog = if let Some(cache) = self.read_cache().await {
            self.log.info(format!("Game list shown from the local cache ({} games).", cache.games.len()));
            Catalog::from_cache(&cache, None)
        } else {
            self.log.info("Game list shown from the built-in snapshot.");
            Catalog::from_bundled(None).await?
        };
        Ok(known(self.publish(catalog)))
    }

    /// Claims the right to refresh in the background; `false` if one is already under way.
    pub fn begin_background_refresh(&self) -> bool {
        !self.refreshing.swap(true, Ordering::AcqRel)
    }

    pub fn end_background_refresh(&self) {
        self.refreshing.store(false, Ordering::Release);
    }

    pub async fn load(&self, force_refresh: bool) -> AppResult<Arc<Catalog>> {
        let _guard = self.load_lock.lock().await;

        if !force_refresh
            && let Some(current) = self.current().filter(|catalog| catalog.is_fresh())
        {
            return Ok(current);
        }

        let cached = self.read_cache().await;

        if !force_refresh
            && let Some(cache) = cached.as_ref().filter(|cache| now_millis() - cache.fetched_at < CACHE_TTL_MS)
        {
            self.log.info(format!("Game list loaded from the local cache ({} games).", cache.games.len()));
            return Ok(self.publish(Catalog::from_cache(cache, None)));
        }

        match self.download().await {
            Ok(games) => {
                let fetched_at = now_millis();
                self.log.info(format!("Game list downloaded from Discord ({} games).", games.len()));
                self.write_cache(CacheFile { fetched_at, games: games.clone() }).await;
                Ok(self.publish(Catalog {
                    games,
                    source: CatalogSource::Discord,
                    fetched_at: Some(fetched_at),
                    refresh_error: None,
                    platform: CURRENT_PLATFORM,
                }))
            }
            Err(error) => {
                let reason = error.to_string();
                self.log.warn(format!("Could not refresh the game list: {reason}"));

                let catalog = match cached {
                    Some(cache) => Catalog::from_cache(&cache, Some(reason)),
                    None => Catalog::from_bundled(Some(reason)).await?,
                };
                Ok(self.publish(catalog))
            }
        }
    }

    fn publish(&self, catalog: Catalog) -> Arc<Catalog> {
        let catalog = Arc::new(catalog);
        *self.current.write().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(Arc::clone(&catalog));
        catalog
    }

    async fn download(&self) -> AppResult<Vec<Game>> {
        let network = |error: reqwest::Error| AppError::Network(error.without_url().to_string());

        let bytes = self
            .client
            .get(DETECTABLE_URL)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(network)?
            .bytes()
            .await
            .map_err(network)?;

        spawn_blocking(move || parse_games(&bytes)).await?
    }

    async fn read_cache(&self) -> Option<CacheFile> {
        let file = self.cache_file.clone();
        let log = Arc::clone(&self.log);

        spawn_blocking(move || match storage::read_json::<CacheFile>(&file) {
            Ok(cache) => cache.filter(|cache| !cache.games.is_empty()),
            Err(error) => {
                log.warn(format!("Could not read the game list cache: {error}"));
                None
            }
        })
        .await
        .ok()
        .flatten()
        .map(|mut cache| {
            annotate_all(&mut cache.games);
            cache
        })
    }

    async fn write_cache(&self, cache: CacheFile) {
        let file = self.cache_file.clone();
        let log = Arc::clone(&self.log);

        let result = spawn_blocking(move || storage::write_json(&file, &cache)).await;
        if let Ok(Err(error)) | Err(error) = result {
            log.warn(format!("Could not save the game list cache: {error}"));
        }
    }
}

impl Catalog {
    fn from_cache(cache: &CacheFile, refresh_error: Option<String>) -> Self {
        Self {
            games: cache.games.clone(),
            source: CatalogSource::Cache,
            fetched_at: Some(cache.fetched_at),
            refresh_error,
            platform: CURRENT_PLATFORM,
        }
    }

    async fn from_bundled(refresh_error: Option<String>) -> AppResult<Self> {
        let games = spawn_blocking(|| parse_games(BUNDLED_SNAPSHOT)).await??;
        Ok(Self {
            games,
            source: CatalogSource::Bundled,
            fetched_at: None,
            refresh_error,
            platform: CURRENT_PLATFORM,
        })
    }
}

/// Parses a `detectable` payload, skipping malformed entries and duplicates.
fn parse_games(bytes: &[u8]) -> AppResult<Vec<Game>> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Entry {
        Valid(Box<Game>),
        Malformed(IgnoredAny),
    }

    let entries: Vec<Entry> =
        serde_json::from_slice(bytes).map_err(|error| AppError::Catalog(error.to_string()))?;

    let mut seen = HashSet::new();
    let mut games: Vec<Game> = entries
        .into_iter()
        .filter_map(|entry| match entry {
            Entry::Valid(game) => Some(*game),
            Entry::Malformed(_) => None,
        })
        .filter(|game| is_valid_game_id(&game.id) && !game.name.trim().is_empty())
        .filter(|game| !game.executables.is_empty() && seen.insert(game.id.clone()))
        .collect();

    if games.is_empty() {
        return Err(AppError::Catalog("the list contains no usable game".into()));
    }

    games.sort_by_cached_key(|game| game.name.to_lowercase());
    annotate_all(&mut games);
    Ok(games)
}

fn annotate_all(games: &mut [Game]) {
    for game in games {
        game.annotate(CURRENT_PLATFORM);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(dir: &tempfile::TempDir) -> CatalogService {
        CatalogService::new(dir.path().join("catalog-cache.json"), Arc::new(AppLog::default())).unwrap()
    }

    #[test]
    fn without_any_cache_the_built_in_snapshot_answers_at_once_and_a_refresh_is_due() {
        let dir = tempfile::tempdir().unwrap();
        let (catalog, refresh_due) = tauri::async_runtime::block_on(service(&dir).load_local()).unwrap();

        assert_eq!(catalog.source, CatalogSource::Bundled);
        assert_eq!(catalog.refresh_error, None, "nothing failed: the download simply has not happened yet");
        assert!(refresh_due);
    }

    #[test]
    fn an_old_cached_download_is_shown_at_once_but_is_due_for_a_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let old = CacheFile { fetched_at: now_millis() - 2 * CACHE_TTL_MS, games: parse_games(BUNDLED_SNAPSHOT).unwrap() };
        storage::write_json(&dir.path().join("catalog-cache.json"), &old).unwrap();

        let (catalog, refresh_due) = tauri::async_runtime::block_on(service(&dir).load_local()).unwrap();
        assert_eq!(catalog.source, CatalogSource::Cache);
        assert!(refresh_due);
    }

    #[test]
    fn a_recent_cached_download_needs_no_refresh() {
        let dir = tempfile::tempdir().unwrap();
        let recent = CacheFile { fetched_at: now_millis(), games: parse_games(BUNDLED_SNAPSHOT).unwrap() };
        storage::write_json(&dir.path().join("catalog-cache.json"), &recent).unwrap();

        let (_, refresh_due) = tauri::async_runtime::block_on(service(&dir).load_local()).unwrap();
        assert!(!refresh_due);
    }

    #[test]
    fn only_one_background_refresh_runs_at_a_time() {
        let dir = tempfile::tempdir().unwrap();
        let service = service(&dir);

        assert!(service.begin_background_refresh());
        assert!(!service.begin_background_refresh());
        service.end_background_refresh();
        assert!(service.begin_background_refresh());
    }

    #[test]
    fn bundled_snapshot_is_valid() {
        let games = parse_games(BUNDLED_SNAPSHOT).unwrap();
        assert!(games.len() > 1000);
        assert!(games.iter().any(|game| game.name == "Overwatch"));
    }

    #[test]
    fn skips_malformed_entries_instead_of_failing() {
        let games = parse_games(
            br#"[
                { "id": "1", "name": "Valid", "executables": [{ "name": "a.exe", "os": "win32" }] },
                { "id": 2, "name": "Numeric id" },
                { "name": "No id" },
                "garbage",
                null
            ]"#,
        )
        .unwrap();

        assert_eq!(games.len(), 1);
        assert_eq!(games[0].name, "Valid");
    }

    #[test]
    fn drops_unsafe_ids_duplicates_and_games_without_executables() {
        let games = parse_games(
            br#"[
                { "id": "../1", "name": "Bad id", "executables": [{ "name": "a.exe", "os": "win32" }] },
                { "id": "3", "name": "No exe", "executables": [] },
                { "id": "4", "name": "First", "executables": [{ "name": "a.exe", "os": "win32" }] },
                { "id": "4", "name": "Duplicate", "executables": [{ "name": "a.exe", "os": "win32" }] }
            ]"#,
        )
        .unwrap();

        let names: Vec<_> = games.iter().map(|game| game.name.as_str()).collect();
        assert_eq!(names, ["First"]);
    }

    #[test]
    fn sorts_case_insensitively() {
        let games = parse_games(
            br#"[
                { "id": "1", "name": "banana", "executables": [{ "name": "a.exe", "os": "win32" }] },
                { "id": "2", "name": "Apple", "executables": [{ "name": "a.exe", "os": "win32" }] }
            ]"#,
        )
        .unwrap();

        assert_eq!(games[0].name, "Apple");
    }

    #[test]
    fn rejects_payloads_without_any_usable_game() {
        assert!(parse_games(b"[]").is_err());
        assert!(parse_games(b"{}").is_err());
        assert!(parse_games(b"<html>error</html>").is_err());
    }
}
