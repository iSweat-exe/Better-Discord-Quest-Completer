//! Application-wide error type.
//!
//! Errors cross the IPC boundary as `{ kind, message }`: the frontend maps
//! `kind` to a localized message and only falls back to `message` (English,
//! meant for logs) for kinds it does not know.

use std::io;

use serde::ser::{Serialize, SerializeStruct, Serializer};

use crate::games::executable::PathRejection;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("`{0}` is not a valid Discord application id")]
    InvalidGameId(String),

    #[error("game `{0}` was not found")]
    GameNotFound(String),

    #[error("executable `{name}` cannot be used: {reason}")]
    InvalidExecutable { name: String, reason: PathRejection },

    #[error("executable `{0}` is not registered for this platform")]
    ExecutableUnavailable(String),

    #[error("this platform is not supported yet")]
    UnsupportedPlatform,

    #[error("`{0}` is already running")]
    AlreadyRunning(String),

    #[error("session `{0}` does not exist")]
    SessionNotFound(String),

    #[error("`{0}` is currently running")]
    GameRunning(String),

    #[error("{context}: {source}")]
    Io {
        context: &'static str,
        #[source]
        source: io::Error,
    },

    #[error("no Discord token is saved")]
    TokenMissing,

    #[error("Discord rejected the token")]
    TokenInvalid,

    #[error("the token does not look like a Discord token")]
    TokenFormat,

    #[error("network error: {0}")]
    Network(String),

    #[error("update failed: {0}")]
    Update(String),

    #[error("invalid game list: {0}")]
    Catalog(String),

    #[error("Discord is not running or its IPC pipe is unavailable")]
    DiscordNotRunning,

    #[error("Discord presence error: {0}")]
    Presence(String),

    #[error("{0}")]
    Internal(String),
}

impl AppError {
    /// Stable identifier consumed by the frontend.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InvalidGameId(_) => "invalidGameId",
            Self::GameNotFound(_) => "gameNotFound",
            Self::InvalidExecutable { .. } => "invalidExecutable",
            Self::ExecutableUnavailable(_) => "executableUnavailable",
            Self::UnsupportedPlatform => "unsupportedPlatform",
            Self::AlreadyRunning(_) => "alreadyRunning",
            Self::SessionNotFound(_) => "sessionNotFound",
            Self::GameRunning(_) => "gameRunning",
            Self::Io { .. } => "io",
            Self::TokenMissing => "tokenMissing",
            Self::TokenInvalid => "tokenInvalid",
            Self::TokenFormat => "tokenFormat",
            Self::Network(_) => "network",
            Self::Update(_) => "update",
            Self::Catalog(_) => "catalog",
            Self::DiscordNotRunning => "discordNotRunning",
            Self::Presence(_) => "presence",
            Self::Internal(_) => "internal",
        }
    }

    /// Builds an adapter for `map_err` that tags an I/O error with its context.
    pub fn io(context: &'static str) -> impl FnOnce(io::Error) -> Self {
        move |source| Self::Io { context, source }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_kind_and_message() {
        let json = serde_json::to_value(AppError::AlreadyRunning("Game".into())).unwrap();
        assert_eq!(json["kind"], "alreadyRunning");
        assert_eq!(json["message"], "`Game` is already running");
    }

    #[test]
    fn io_helper_keeps_the_context() {
        let error = AppError::io("writing settings")(io::Error::other("disk full"));
        assert_eq!(error.to_string(), "writing settings: disk full");
    }
}
