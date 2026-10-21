//! The one place that decides how this app talks HTTP.
//!
//! Every client is built from [`builder`], so the identity the app announces
//! (`User-Agent`), the timeouts and the content type live here and nowhere else.
//! Requests that carry the token present themselves as Discord's web client,
//! with the values captured from a real session (see [`super_properties`]).

use std::collections::hash_map::RandomState;
use std::fmt::Write as _;
use std::hash::{BuildHasher, Hasher};
use std::sync::OnceLock;
use std::time::Duration;

use reqwest::ClientBuilder;
use reqwest::header::{ACCEPT_LANGUAGE, HeaderMap, HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use serde_json::json;

use crate::error::{AppError, AppResult};

/// Chrome as announced by the captured session. `USER_AGENT`, `X-Super-Properties`
/// and the client hints must all agree on it.
const CHROME_VERSION: &str = "155.0.0.0";
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
/// Build of Discord's web client in the captured session; refresh it from a new capture.
const CLIENT_BUILD_NUMBER: u64 = 643_186;
pub const CONTENT_TYPE_JSON: &str = "application/json";

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
/// A request to Discord's API.
pub const API_TIMEOUT: Duration = Duration::from_secs(20);
/// Downloading the games catalog.
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(45);

/// What every client has in common.
pub fn builder(timeout: Duration) -> ClientBuilder {
    reqwest::Client::builder().user_agent(USER_AGENT).connect_timeout(CONNECT_TIMEOUT).timeout(timeout)
}

/// A client for requests that carry the user's token: HTTPS only, and no redirect
/// is ever followed (a redirect would otherwise be a way to forward the header).
/// It also sends the headers the official desktop client adds to every API call.
pub fn authenticated_client() -> AppResult<reqwest::Client> {
    finish(builder(API_TIMEOUT).https_only(true).redirect(Policy::none()).default_headers(discord_headers()))
}

/// `X-Super-Properties`: the base64 JSON the client describes itself with. The
/// fields are those of a real capture; the ids are random, fixed for the run.
fn super_properties(locale: &str) -> String {
    let properties = json!({
        "os": "Windows",
        "browser": "Chrome",
        "device": "",
        "device_model_name": "",
        "system_locale": locale,
        "has_client_mods": false,
        "browser_user_agent": USER_AGENT,
        "browser_version": CHROME_VERSION,
        "os_version": "10",
        "referrer": "",
        "referring_domain": "",
        "referrer_current": "",
        "referring_domain_current": "",
        "release_channel": "stable",
        "client_build_number": CLIENT_BUILD_NUMBER,
        "client_event_source": null,
        "client_launch_id": session_ids().0,
        "launch_signature": session_ids().1,
        "client_heartbeat_session_id": session_ids().2,
        "client_app_state": "focused",
    });
    base64(properties.to_string().as_bytes())
}

fn session_ids() -> &'static (String, String, String) {
    static IDS: OnceLock<(String, String, String)> = OnceLock::new();
    IDS.get_or_init(|| (uuid_v4(), uuid_v4(), uuid_v4()))
}

fn uuid_v4() -> String {
    let random = |seed: u8| {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u8(seed);
        hasher.finish()
    };
    let mut bytes = [0u8; 16];
    bytes[..8].copy_from_slice(&random(0).to_le_bytes());
    bytes[8..].copy_from_slice(&random(1).to_le_bytes());
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = bytes.iter().fold(String::new(), |mut out, byte| {
        let _ = write!(out, "{byte:02x}");
        out
    });
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

fn discord_headers() -> HeaderMap {
    let locale = sys_locale::get_locale().unwrap_or_else(|| "en-US".to_owned());
    let mut headers = HeaderMap::new();
    let mut put = |name: &'static str, value: &str| {
        if let Ok(value) = HeaderValue::from_str(value) {
            headers.insert(HeaderName::from_static(name), value);
        }
    };
    put("x-super-properties", &super_properties(&locale));
    put("x-discord-locale", &locale);
    put("x-debug-options", "bugReporterEnabled");
    put("origin", "https://discord.com");
    put("referer", "https://discord.com/channels/@me");
    put("sec-ch-ua-mobile", "?0");
    put("sec-ch-ua-platform", "\"Windows\"");
    put("sec-fetch-dest", "empty");
    put("sec-fetch-mode", "cors");
    put("sec-fetch-site", "same-origin");
    if let Ok(value) = HeaderValue::from_str(&format!("{locale},{};q=0.9", locale.split('-').next().unwrap_or("en"))) {
        headers.insert(ACCEPT_LANGUAGE, value);
    }
    headers
}

fn base64(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(ALPHABET[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A client for requests that carry nothing secret.
pub fn public_client(timeout: Duration) -> AppResult<reqwest::Client> {
    finish(builder(timeout))
}

fn finish(builder: ClientBuilder) -> AppResult<reqwest::Client> {
    builder.build().map_err(|error| AppError::Network(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_user_agent_matches_the_announced_chrome() {
        assert!(USER_AGENT.contains(&format!("Chrome/{CHROME_VERSION}")));
    }

    #[test]
    fn uuids_have_the_v4_shape() {
        let id = uuid_v4();
        assert_eq!(id.len(), 36);
        assert_eq!(id.as_bytes()[14], b'4');
        assert_ne!(id, uuid_v4());
    }

    #[test]
    fn base64_matches_the_standard_alphabet() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn the_discord_headers_are_present() {
        let headers = discord_headers();
        assert!(headers.contains_key("x-super-properties"));
        assert!(headers.contains_key("x-discord-locale"));
    }

    #[test]
    fn both_kinds_of_client_build() {
        assert!(authenticated_client().is_ok());
        assert!(public_client(DOWNLOAD_TIMEOUT).is_ok());
    }
}
