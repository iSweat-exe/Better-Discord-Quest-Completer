//! The user's Discord token: validation and secure storage.
//!
//! A token gives full access to a Discord account, so it is handled with care:
//!
//! * it is stored in the operating system's credential store (Windows
//!   Credential Manager), never in a file of this app;
//! * it never appears in logs, errors or `Debug` output;
//! * once saved, it is never handed back to the frontend.

use std::fmt;

use crate::error::{AppError, AppResult};

const SERVICE: &str = "dev.questcompleter.app";
const ACCOUNT: &str = "discord-user-token";
const MIN_LENGTH: usize = 20;
const MAX_LENGTH: usize = 200;

/// A syntactically plausible Discord token.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl fmt::Debug for Token {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Token([redacted])")
    }
}

impl Token {
    /// Cleans up what a user pasted (whitespace, surrounding quotes) and checks
    /// it looks like a token. Nothing is sent to Discord here.
    pub fn parse(raw: &str) -> AppResult<Self> {
        let cleaned = raw.trim().trim_matches(['"', '\'']).trim();

        let plausible = (MIN_LENGTH..=MAX_LENGTH).contains(&cleaned.len())
            && cleaned.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));

        if plausible { Ok(Self(cleaned.to_owned())) } else { Err(AppError::TokenFormat) }
    }

    /// The raw value, for the `Authorization` header only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

/// Where the token lives between runs.
pub trait TokenStore: Send + Sync {
    fn load(&self) -> AppResult<Option<Token>>;
    fn save(&self, token: &Token) -> AppResult<()>;
    fn clear(&self) -> AppResult<()>;
}

/// The operating system's credential store.
pub struct SystemStore;

impl SystemStore {
    fn entry() -> AppResult<keyring::Entry> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(store_error)
    }
}

/// Errors from the credential store never contain the secret.
fn store_error(error: keyring::Error) -> AppError {
    AppError::Internal(format!("credential store: {error}"))
}

impl TokenStore for SystemStore {
    fn load(&self) -> AppResult<Option<Token>> {
        match Self::entry()?.get_password() {
            // An unusable stored value is treated as "no token".
            Ok(stored) => Ok(Token::parse(&stored).ok()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(store_error(error)),
        }
    }

    fn save(&self, token: &Token) -> AppResult<()> {
        Self::entry()?.set_password(token.expose()).map_err(store_error)
    }

    fn clear(&self) -> AppResult<()> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(store_error(error)),
        }
    }
}

/// An in-memory store, for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<Option<Token>>);

#[cfg(test)]
impl TokenStore for MemoryStore {
    fn load(&self) -> AppResult<Option<Token>> {
        Ok(self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone())
    }

    fn save(&self, token: &Token) -> AppResult<()> {
        *self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(token.clone());
        Ok(())
    }

    fn clear(&self) -> AppResult<()> {
        *self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Not a real token: only the shape matters.
    const SAMPLE: &str = "aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbb.cccccccccccccccccccccccccccc";

    #[test]
    fn accepts_a_plausible_token() {
        assert_eq!(Token::parse(SAMPLE).unwrap().expose(), SAMPLE);
    }

    #[test]
    fn strips_whitespace_and_quotes_pasted_with_it() {
        assert_eq!(Token::parse(&format!("  \"{SAMPLE}\"\n")).unwrap().expose(), SAMPLE);
        assert_eq!(Token::parse(&format!("'{SAMPLE}'")).unwrap().expose(), SAMPLE);
    }

    #[test]
    fn rejects_values_that_cannot_be_tokens() {
        let too_long = "a".repeat(201);
        for bad in ["", "short", too_long.as_str(), "has space in the middle of it xx", "inv@lid!chars_in_here_xx", "Bot aaaaaaaaaaaaaaaaaaaaaaaa"] {
            assert_eq!(Token::parse(bad).unwrap_err().kind(), "tokenFormat", "{bad}");
        }
    }

    #[test]
    fn debug_output_never_shows_the_token() {
        let token = Token::parse(SAMPLE).unwrap();
        assert!(!format!("{token:?}").contains("aaaa"));
        assert!(!format!("{:?}", Some(&token)).contains("bbbb"));
    }

    #[test]
    fn the_memory_store_round_trips() {
        let store = MemoryStore::default();
        assert_eq!(store.load().unwrap(), None);

        store.save(&Token::parse(SAMPLE).unwrap()).unwrap();
        assert_eq!(store.load().unwrap().unwrap().expose(), SAMPLE);

        store.clear().unwrap();
        assert_eq!(store.load().unwrap(), None);
    }
}
