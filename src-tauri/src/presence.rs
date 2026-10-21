//! Experimental Rich Presence: shows a game's activity on the user's profile
//! through Discord's local IPC pipe, without any process running.
//!
//! This borrows the game's application id, which is a grey area of Discord's
//! terms: the UI asks for explicit confirmation before using it.

use std::sync::{Mutex, MutexGuard, PoisonError};

use discord_rich_presence::activity::{Activity, ActivityType, Timestamps};
use discord_rich_presence::error::Error as IpcError;
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::games::model::Game;
use crate::util::now_millis;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceKind {
    #[default]
    Playing,
    Listening,
    Watching,
    Competing,
}

impl From<PresenceKind> for ActivityType {
    fn from(kind: PresenceKind) -> Self {
        match kind {
            PresenceKind::Playing => Self::Playing,
            PresenceKind::Listening => Self::Listening,
            PresenceKind::Watching => Self::Watching,
            PresenceKind::Competing => Self::Competing,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceRequest {
    pub game_id: String,
    pub details: Option<String>,
    pub state: Option<String>,
    /// Pretends the activity started this many minutes ago.
    pub elapsed_minutes: Option<u32>,
    #[serde(default)]
    pub kind: PresenceKind,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceStatus {
    pub connected: bool,
    pub game_id: Option<String>,
    pub game_name: Option<String>,
}

struct Connection {
    client: DiscordIpcClient,
    app_id: String,
}

impl Connection {
    fn open(app_id: &str) -> AppResult<Self> {
        let mut client = DiscordIpcClient::new(app_id);
        client.connect().map_err(map_error)?;
        Ok(Self { client, app_id: app_id.to_owned() })
    }
}

#[derive(Default)]
pub struct PresenceManager {
    connection: Mutex<Option<Connection>>,
    status: Mutex<PresenceStatus>,
}

impl PresenceManager {
    pub fn status(&self) -> PresenceStatus {
        lock(&self.status).clone()
    }

    /// Connects (or updates the existing connection) and publishes the activity.
    ///
    /// Blocking: call it from a blocking thread.
    pub fn publish(&self, game: &Game, request: &PresenceRequest) -> AppResult<PresenceStatus> {
        let mut slot = lock(&self.connection);

        // Take the connection out of the slot: it only goes back in once it is known to work.
        let mut open = match slot.take() {
            // A different application id requires a brand new connection.
            Some(existing) if existing.app_id != game.id => {
                close(Some(existing));
                Connection::open(&game.id)?
            }
            Some(existing) => existing,
            None => Connection::open(&game.id)?,
        };

        if let Err(error) = open.client.set_activity(build_activity(request)) {
            close(Some(open));
            self.set_status(PresenceStatus::default());
            return Err(map_error(error));
        }

        *slot = Some(open);
        let status = PresenceStatus {
            connected: true,
            game_id: Some(game.id.clone()),
            game_name: Some(game.name.clone()),
        };
        self.set_status(status.clone());
        Ok(status)
    }

    pub fn disconnect(&self) -> PresenceStatus {
        close(lock(&self.connection).take());
        self.set_status(PresenceStatus::default());
        PresenceStatus::default()
    }

    fn set_status(&self, status: PresenceStatus) {
        *lock(&self.status) = status;
    }
}

fn close(connection: Option<Connection>) {
    if let Some(mut connection) = connection {
        // Closing a pipe that Discord already dropped is not an error worth reporting.
        let _ = connection.client.clear_activity();
        let _ = connection.client.close();
    }
}

fn build_activity(request: &PresenceRequest) -> Activity<'_> {
    let mut activity = Activity::new().activity_type(request.kind.into());

    if let Some(details) = non_empty(request.details.as_deref()) {
        activity = activity.details(details);
    }
    if let Some(state) = non_empty(request.state.as_deref()) {
        activity = activity.state(state);
    }
    if let Some(minutes) = request.elapsed_minutes {
        let started = now_millis() - i64::from(minutes) * 60_000;
        activity = activity.timestamps(Timestamps::new().start(started));
    }
    activity
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn map_error(error: IpcError) -> AppError {
    match error {
        IpcError::IPCNotFound | IpcError::IPCConnectionFailed => AppError::DiscordNotRunning,
        other => AppError::Presence(other.to_string()),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_fields_are_left_out() {
        assert_eq!(non_empty(Some("  ")), None);
        assert_eq!(non_empty(None), None);
        assert_eq!(non_empty(Some(" hi ")), Some("hi"));
    }

    #[test]
    fn missing_discord_is_reported_as_such() {
        assert_eq!(map_error(IpcError::IPCNotFound).kind(), "discordNotRunning");
        assert_eq!(map_error(IpcError::NotConnected).kind(), "presence");
    }

    #[test]
    fn disconnecting_when_idle_is_harmless() {
        let manager = PresenceManager::default();
        assert!(!manager.disconnect().connected);
        assert_eq!(manager.status(), PresenceStatus::default());
    }

    #[test]
    fn request_defaults_to_playing() {
        let request: PresenceRequest = serde_json::from_str(r#"{ "gameId": "1" }"#).unwrap();
        assert_eq!(request.kind, PresenceKind::Playing);
    }
}
