//! The read-only requests this app makes with the user's token.

use std::time::Duration;

use reqwest::redirect::Policy;
use serde_json::Value;

use super::token::Token;
use crate::error::{AppError, AppResult};

const QUESTS_URL: &str = "https://discord.com/api/v10/quests/@me";
const PROFILE_URL: &str = "https://discord.com/api/v10/users/@me";
const ORBS_BALANCE_URL: &str = "https://discord.com/api/v10/users/@me/virtual-currency/balance";
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// A client that cannot leak the token: HTTPS only, and no redirect is ever
/// followed (a redirect would otherwise be a way to forward the header).
pub fn build() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("DiscordQuestCompleter/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| AppError::Network(error.to_string()))
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

/// A `GET` whose only secret is the `Authorization` header.
async fn get_json(client: &reqwest::Client, url: &str, token: &Token) -> AppResult<Value> {
    let network = |error: reqwest::Error| AppError::Network(error.without_url().to_string());

    let response = client
        .get(url)
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
    fn the_client_builds() {
        assert!(build().is_ok());
    }
}
