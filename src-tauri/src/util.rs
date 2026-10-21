use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};

/// Milliseconds since the Unix epoch (0 if the clock is set before it).
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
}

/// Runs blocking work (file system, parsing, blocking IPC) off the async runtime.
pub async fn spawn_blocking<T, F>(task: F) -> AppResult<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::Internal(format!("background task failed: {error}")))
}
