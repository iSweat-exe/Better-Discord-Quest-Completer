//! The account behind the token, in more detail than [`super::model::Profile`],
//! and the changes the user can make to it.
//!
//! Only what the profile page shows is read: never the email, the phone or the
//! billing details, even though `GET /users/@me` returns some of them.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::model::{field, text};
use crate::error::{AppError, AppResult};

/// Discord's limits, checked before anything is sent.
pub const DISPLAY_NAME_MAX: usize = 32;
pub const PRONOUNS_MAX: usize = 40;
pub const BIO_MAX: usize = 190;

/// Discord's epoch (2015-01-01), in Unix milliseconds: snowflakes count from it.
const DISCORD_EPOCH_MS: i64 = 1_420_070_400_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Premium {
    None,
    Classic,
    Nitro,
    Basic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub id: String,
    /// Already in the user's language (Discord localizes it).
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDetails {
    pub id: String,
    pub username: String,
    /// The display name as set; `None` when the account shows its username.
    pub display_name: Option<String>,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub accent_color: Option<u32>,
    pub bio: String,
    pub pronouns: String,
    pub premium: Premium,
    /// Unix milliseconds, read from the id.
    pub created_at: i64,
    pub mfa_enabled: bool,
    pub verified: bool,
    pub badges: Vec<Badge>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Guild {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub owner: bool,
    pub member_count: Option<u64>,
}

/// What the user asked to change. A `None` field stays as it is; an empty
/// display name goes back to the username.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileEdit {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
}

impl ProfileEdit {
    /// Trims the fields and checks them against Discord's limits.
    pub fn validated(self) -> AppResult<Self> {
        let clean = |value: Option<String>, max: usize, what: &str| -> AppResult<Option<String>> {
            let Some(value) = value else { return Ok(None) };
            let value = value.trim().to_owned();
            if value.chars().count() > max {
                return Err(AppError::Network(format!("The {what} is longer than {max} characters")));
            }
            if value.chars().any(|c| c.is_control() && c != '\n') {
                return Err(AppError::Network(format!("The {what} contains invalid characters")));
            }
            Ok(Some(value))
        };
        let edit = Self {
            display_name: clean(self.display_name, DISPLAY_NAME_MAX, "display name")?,
            bio: clean(self.bio, BIO_MAX, "bio")?,
            pronouns: clean(self.pronouns, PRONOUNS_MAX, "pronouns")?,
        };
        if edit.display_name.as_deref().is_some_and(|name| name.contains('\n'))
            || edit.pronouns.as_deref().is_some_and(|pronouns| pronouns.contains('\n'))
        {
            return Err(AppError::Network("Line breaks are only allowed in the bio".into()));
        }
        if edit.is_empty() {
            return Err(AppError::Network("Nothing to change".into()));
        }
        Ok(edit)
    }

    pub fn is_empty(&self) -> bool {
        self.display_name.is_none() && self.bio.is_none() && self.pronouns.is_none()
    }

    /// The body of `PATCH /users/@me/profile`, `None` when neither field changes.
    pub fn profile_body(&self) -> Option<Value> {
        let mut body = Map::new();
        if let Some(bio) = &self.bio {
            body.insert("bio".into(), Value::String(bio.clone()));
        }
        if let Some(pronouns) = &self.pronouns {
            body.insert("pronouns".into(), Value::String(pronouns.clone()));
        }
        (!body.is_empty()).then_some(Value::Object(body))
    }

    /// For the write history: which fields changed.
    pub fn summary(&self) -> String {
        let mut fields = Vec::new();
        if self.display_name.is_some() {
            fields.push("display name");
        }
        if self.pronouns.is_some() {
            fields.push("pronouns");
        }
        if self.bio.is_some() {
            fields.push("bio");
        }
        format!("Profile: {}", fields.join(", "))
    }
}

/// When a snowflake was made, in Unix milliseconds.
pub fn snowflake_time(id: &str) -> Option<i64> {
    let raw: u64 = id.parse().ok()?;
    i64::try_from(raw >> 22).ok().map(|ms| ms + DISCORD_EPOCH_MS)
}

/// Reads `GET /users/@me` and, when it answered, `GET /users/{id}/profile`.
pub fn parse_account(me: &Value, profile: Option<&Value>) -> Option<AccountDetails> {
    let id = text(me, &["id"])?;
    let username = text(me, &["username"])?;
    let user_profile = profile.and_then(|profile| field(profile, &["user_profile", "userProfile"]));
    let from_profile = |names: &[&str]| user_profile.and_then(|value| text(value, names));

    let premium = match field(me, &["premium_type", "premiumType"]).and_then(Value::as_u64) {
        Some(1) => Premium::Classic,
        Some(2) => Premium::Nitro,
        Some(3) => Premium::Basic,
        _ => Premium::None,
    };
    let badges = profile
        .and_then(|profile| field(profile, &["badges"]))
        .and_then(Value::as_array)
        .map(|badges| {
            badges
                .iter()
                .filter_map(|badge| Some(Badge { id: text(badge, &["id"])?, description: text(badge, &["description"])? }))
                .take(24)
                .collect()
        })
        .unwrap_or_default();
    let flag = |names: &[&str]| field(me, names).and_then(Value::as_bool).unwrap_or(false);

    Some(AccountDetails {
        created_at: snowflake_time(&id)?,
        display_name: text(me, &["global_name", "globalName"]),
        avatar: text(me, &["avatar"]),
        banner: text(me, &["banner"]),
        accent_color: field(me, &["accent_color", "accentColor"]).and_then(Value::as_u64).and_then(|color| u32::try_from(color).ok()),
        bio: from_profile(&["bio"]).or_else(|| text(me, &["bio"])).unwrap_or_default(),
        pronouns: from_profile(&["pronouns"]).unwrap_or_default(),
        premium,
        mfa_enabled: flag(&["mfa_enabled", "mfaEnabled"]),
        verified: flag(&["verified"]),
        badges,
        id,
        username,
    })
}

/// Reads `GET /users/@me/guilds`, sorted by name.
pub fn parse_guilds(answer: &Value) -> Vec<Guild> {
    let mut guilds: Vec<Guild> = answer
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|guild| {
                    Some(Guild {
                        id: text(guild, &["id"])?,
                        name: text(guild, &["name"])?,
                        icon: text(guild, &["icon"]),
                        owner: field(guild, &["owner"]).and_then(Value::as_bool).unwrap_or(false),
                        member_count: field(guild, &["approximate_member_count"]).and_then(Value::as_u64),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    guilds.sort_by_key(|guild| guild.name.to_lowercase());
    guilds
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_the_account_and_its_profile() {
        let me = json!({
            "id": "80351110224678912", "username": "nelly", "global_name": "Nelly", "avatar": "abc",
            "premium_type": 2, "mfa_enabled": true, "verified": true, "accent_color": 16_711_680,
            "email": "never@read.me", "phone": "+33"
        });
        let profile = json!({
            "user_profile": { "bio": "Hello", "pronouns": "she/her" },
            "badges": [{ "id": "premium", "description": "Abonné depuis 2020", "icon": "x" }, { "id": "broken" }]
        });
        let account = parse_account(&me, Some(&profile)).unwrap();

        assert_eq!(account.display_name.as_deref(), Some("Nelly"));
        assert_eq!(account.premium, Premium::Nitro);
        assert_eq!((account.bio.as_str(), account.pronouns.as_str()), ("Hello", "she/her"));
        assert_eq!(account.badges, vec![Badge { id: "premium".into(), description: "Abonné depuis 2020".into() }]);
        assert_eq!(account.created_at, 1_439_227_597_529);
        assert!(account.mfa_enabled && account.verified);
        assert!(!serde_json::to_string(&account).unwrap().contains("never@read.me"));
    }

    #[test]
    fn an_account_without_its_profile_still_reads() {
        let account = parse_account(&json!({ "id": "1", "username": "nelly", "bio": "From me" }), None).unwrap();
        assert_eq!((account.bio.as_str(), account.premium, account.display_name), ("From me", Premium::None, None));
        assert!(parse_account(&json!({ "username": "nelly" }), None).is_none());
    }

    #[test]
    fn reads_and_sorts_the_guilds() {
        let guilds = parse_guilds(&json!([
            { "id": "2", "name": "zeta", "owner": true, "approximate_member_count": 12 },
            { "id": "1", "name": "Alpha", "icon": "i" },
            { "name": "no id" }
        ]));
        assert_eq!(guilds.iter().map(|guild| guild.id.as_str()).collect::<Vec<_>>(), ["1", "2"]);
        assert_eq!((guilds[1].owner, guilds[1].member_count), (true, Some(12)));
        assert!(parse_guilds(&json!({})).is_empty());
    }

    #[test]
    fn edits_are_checked_before_being_sent() {
        let edit = ProfileEdit { display_name: Some("  Nelly ".into()), ..ProfileEdit::default() }.validated().unwrap();
        assert_eq!(edit.display_name.as_deref(), Some("Nelly"));
        assert_eq!(edit.profile_body(), None);

        assert!(ProfileEdit::default().validated().is_err());
        assert!(ProfileEdit { bio: Some("x".repeat(191)), ..ProfileEdit::default() }.validated().is_err());
        assert!(ProfileEdit { display_name: Some("a\nb".into()), ..ProfileEdit::default() }.validated().is_err());

        let bio = ProfileEdit { bio: Some("line\nline".into()), pronouns: Some(String::new()), ..ProfileEdit::default() }
            .validated()
            .unwrap();
        assert_eq!(bio.profile_body(), Some(json!({ "bio": "line\nline", "pronouns": "" })));
        assert_eq!(bio.summary(), "Profile: pronouns, bio");
    }
}
