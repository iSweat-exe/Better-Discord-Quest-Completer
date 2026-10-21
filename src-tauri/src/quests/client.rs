//! The requests this app makes with the user's token: reads, plus the quest
//! actions the user asks for (accept, claim, watch a video).

use serde_json::{Value, json};

use super::token::Token;
use crate::error::{AppError, AppResult};

const QUESTS_URL: &str = "https://discord.com/api/v10/quests/@me";
const QUESTS_BASE_URL: &str = "https://discord.com/api/v10/quests";
/// Where in Discord's UI an action came from (the quests page).
const QUEST_LOCATION: u8 = 11;
const PROFILE_URL: &str = "https://discord.com/api/v10/users/@me";
const ORBS_BALANCE_URL: &str = "https://discord.com/api/v10/users/@me/virtual-currency/balance";
const SHOP_URL: &str = "https://discord.com/api/v10/collectibles-shop?tab=orbs&include_bundles=true";
const SHOP_CATEGORIES_URL: &str = "https://discord.com/api/v10/collectibles-categories?tab=orbs&include_bundles=true";
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// A client that cannot leak the token: see [`crate::http::authenticated_client`].
pub fn build() -> AppResult<reqwest::Client> {
    crate::http::authenticated_client()
}

/// Turns an HTTP status into the error the user should see.
pub fn check_status(status: u16, retry_after: Option<&str>) -> AppResult<()> {
    match status {
        200..=299 => Ok(()),
        401 => Err(AppError::TokenInvalid),
        403 => Err(AppError::Network("Discord refused the request (HTTP 403)".into())),
        429 => Err(AppError::Network(format!(
            "Discord is limiting requests, retry in {} s",
            retry_after.and_then(|seconds| seconds.trim().parse::<u64>().ok()).unwrap_or(30)
        ))),
        other => Err(AppError::Network(format!("Discord answered HTTP {other}"))),
    }
}

/// `GET /quests/@me`.
pub async fn fetch_quests(client: &reqwest::Client, token: &Token) -> AppResult<Value> {
    get_json(client, QUESTS_URL, token).await
}

/// `GET /users/@me`: who the token belongs to.
pub async fn fetch_profile(client: &reqwest::Client, token: &Token) -> AppResult<Value> {
    get_json(client, PROFILE_URL, token).await
}

/// `GET /users/@me/virtual-currency/balance`: the Orbs the account holds.
///
/// Unlike the quests endpoint this route is unverified against Discord's own
/// client, so callers must treat any failure as "no balance to show".
pub async fn fetch_orbs_balance(client: &reqwest::Client, token: &Token) -> AppResult<Value> {
    get_json(client, ORBS_BALANCE_URL, token).await
}

/// `GET /collectibles-shop?tab=orbs`: the shop's Orbs tab.
///
/// Undocumented by Discord and unverified against its own client: when the shop
/// home refuses the request, the plain categories listing is tried.
pub async fn fetch_orbs_shop(client: &reqwest::Client, token: &Token) -> AppResult<Value> {
    match get_json(client, SHOP_URL, token).await {
        Err(AppError::Network(_)) => get_json(client, SHOP_CATEGORIES_URL, token).await,
        other => other,
    }
}

/// `POST /quests/{id}/enroll`: accepts the quest.
pub async fn enroll_quest(client: &reqwest::Client, token: &Token, quest_id: &str) -> AppResult<Value> {
    let url = quest_url(quest_id, "enroll")?;
    post_json(client, &url, token, &json!({ "location": QUEST_LOCATION, "is_targeted": false, "metadata_raw": null })).await
}

/// `POST /quests/{id}/claim-reward`: claims the reward of a completed quest.
pub async fn claim_quest_reward(client: &reqwest::Client, token: &Token, quest_id: &str) -> AppResult<Value> {
    let url = quest_url(quest_id, "claim-reward")?;
    post_json(client, &url, token, &json!({ "platform": 0, "location": QUEST_LOCATION, "is_targeted": false, "metadata_raw": null }))
        .await
}

/// `POST /quests/{id}/video-progress`: reports how far (in seconds) a video was watched.
pub async fn post_video_progress(client: &reqwest::Client, token: &Token, quest_id: &str, timestamp: u64) -> AppResult<Value> {
    let url = quest_url(quest_id, "video-progress")?;
    post_json(client, &url, token, &json!({ "timestamp": timestamp })).await
}

/// The quest id goes into the path: only digits are accepted, nothing else can reshape the URL.
fn quest_url(quest_id: &str, action: &str) -> AppResult<String> {
    if quest_id.is_empty() || !quest_id.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AppError::Network("Invalid quest id".into()));
    }
    Ok(format!("{QUESTS_BASE_URL}/{quest_id}/{action}"))
}

/// A `GET` whose only secret is the `Authorization` header.
async fn get_json(client: &reqwest::Client, url: &str, token: &Token) -> AppResult<Value> {
    send(client.get(url), token).await
}

/// A `POST` with a JSON body, under the same rules as [`get_json`]. An empty answer is `null`.
async fn post_json(client: &reqwest::Client, url: &str, token: &Token, body: &Value) -> AppResult<Value> {
    let request = client.post(url).header(reqwest::header::CONTENT_TYPE, crate::http::CONTENT_TYPE_JSON).body(body.to_string());
    send(request, token).await
}

async fn send(request: reqwest::RequestBuilder, token: &Token) -> AppResult<Value> {
    let network = |error: reqwest::Error| AppError::Network(error.without_url().to_string());

    let response = request
        .header(reqwest::header::AUTHORIZATION, token.expose())
        .send()
        .await
        .map_err(network)?;

    let retry_after = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    check_status(response.status().as_u16(), retry_after.as_deref())?;

    let bytes = response.bytes().await.map_err(network)?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::Network("Discord's answer is unexpectedly large".into()));
    }
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::Network("Discord's answer is not valid JSON".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_statuses_pass() {
        assert!(check_status(200, None).is_ok());
        assert!(check_status(204, None).is_ok());
    }

    #[test]
    fn unauthorized_means_the_token_is_invalid() {
        assert_eq!(check_status(401, None).unwrap_err().kind(), "tokenInvalid");
    }

    #[test]
    fn rate_limits_tell_how_long_to_wait() {
        let message = check_status(429, Some("12")).unwrap_err().to_string();
        assert!(message.contains("12 s"), "{message}");
        assert!(check_status(429, Some("junk")).unwrap_err().to_string().contains("30 s"));
    }

    #[test]
    fn other_statuses_are_network_errors() {
        assert_eq!(check_status(403, None).unwrap_err().kind(), "network");
        assert_eq!(check_status(500, None).unwrap_err().kind(), "network");
        assert_eq!(check_status(302, None).unwrap_err().kind(), "network");
    }

    #[test]
    fn only_numeric_quest_ids_reach_the_url() {
        assert_eq!(quest_url("123", "enroll").unwrap(), "https://discord.com/api/v10/quests/123/enroll");
        assert!(quest_url("", "enroll").is_err());
        assert!(quest_url("1/../2", "enroll").is_err());
        assert!(quest_url("12?x=1", "enroll").is_err());
    }

    #[test]
    fn the_client_builds() {
        assert!(build().is_ok());
    }
}
