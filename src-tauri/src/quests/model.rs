//! Discord quests, normalized for the frontend.
//!
//! The quests endpoint is not documented, so its answer is read defensively:
//! every field is optional, names are accepted in `snake_case` and
//! `camelCase`, and a quest that cannot be fully understood is still listed
//! with whatever could be read. The raw answer is kept so a mismatch can be
//! diagnosed.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskKind {
    PlayOnDesktop,
    PlayOnXbox,
    PlayOnPlaystation,
    WatchVideo,
    WatchVideoOnMobile,
    StreamOnDesktop,
    PlayActivity,
    Other,
}

impl TaskKind {
    fn from_name(name: &str) -> Self {
        match name.to_ascii_uppercase().as_str() {
            "PLAY_ON_DESKTOP" | "PLAY_ON_DESKTOP_V2" => Self::PlayOnDesktop,
            "PLAY_ON_XBOX" => Self::PlayOnXbox,
            "PLAY_ON_PLAYSTATION" => Self::PlayOnPlaystation,
            "WATCH_VIDEO" => Self::WatchVideo,
            "WATCH_VIDEO_ON_MOBILE" => Self::WatchVideoOnMobile,
            "STREAM_ON_DESKTOP" => Self::StreamOnDesktop,
            "PLAY_ACTIVITY" => Self::PlayActivity,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestTask {
    pub kind: TaskKind,
    /// What the quest asks for, in seconds.
    pub target_seconds: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuestStatus {
    /// Not accepted yet.
    Available,
    Enrolled,
    Completed,
    /// The reward was claimed.
    Claimed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quest {
    pub id: String,
    pub name: String,
    pub game_title: Option<String>,
    pub publisher: Option<String>,
    /// Discord application id of the game: matches the catalog's game ids.
    pub application_id: Option<String>,
    pub reward: Option<String>,
    /// Orbs the reward grants, when it is Orbs.
    pub reward_orbs: Option<u64>,
    /// Unix milliseconds.
    pub starts_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub tasks: Vec<QuestTask>,
    pub status: QuestStatus,
    /// Progress reported by Discord for the first task, in seconds.
    pub progress_seconds: Option<u64>,
    /// Unix milliseconds. Together with `claimed_at`, this is the reward history.
    pub completed_at: Option<i64>,
    pub claimed_at: Option<i64>,
}

impl QuestStatus {
    /// Whether the objective is still to be done (as opposed to being done).
    pub fn is_unfinished(self) -> bool {
        matches!(self, Self::Available | Self::Enrolled)
    }
}

/// Looks `names` up in order: the API uses `snake_case`, client stores `camelCase`.
fn field<'a>(value: &'a Value, names: &[&str]) -> Option<&'a Value> {
    names.iter().find_map(|name| value.get(name)).filter(|found| !found.is_null())
}

fn text(value: &Value, names: &[&str]) -> Option<String> {
    let found = field(value, names)?;
    // Some ids are numbers in older payloads.
    let raw = found.as_str().map(str::to_owned).or_else(|| found.as_u64().map(|number| number.to_string()))?;
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

fn timestamp(value: &Value, names: &[&str]) -> Option<i64> {
    let raw = field(value, names)?.as_str()?;
    DateTime::parse_from_rfc3339(raw).ok().map(|date| date.timestamp_millis())
}

fn tasks(config: &Value) -> Vec<QuestTask> {
    let container = field(config, &["task_config", "taskConfig", "task_config_v2", "taskConfigV2"])
        .and_then(|task_config| field(task_config, &["tasks"]));

    let parse = |key: Option<&str>, task: &Value| {
        let name = text(task, &["type"]).or_else(|| key.map(str::to_owned))?;
        let target = field(task, &["target", "target_seconds", "targetSeconds"]).and_then(Value::as_u64)?;
        Some(QuestTask { kind: TaskKind::from_name(&name), target_seconds: target })
    };

    match container {
        Some(Value::Object(map)) => map.iter().filter_map(|(key, task)| parse(Some(key), task)).collect(),
        Some(Value::Array(list)) => list.iter().filter_map(|task| parse(None, task)).collect(),
        _ => Vec::new(),
    }
}

fn reward(config: &Value) -> Option<String> {
    let rewards = field(config, &["rewards_config", "rewardsConfig"])
        .and_then(|rewards_config| field(rewards_config, &["rewards"]))?
        .as_array()?;

    rewards.iter().find_map(|reward| {
        let messages = field(reward, &["messages"])?;
        text(messages, &["name", "name_with_article", "nameWithArticle"])
    })
}

/// Orbs granted by the quest: the `orb_quantity` of its rewards, added up.
fn reward_orbs(config: &Value) -> Option<u64> {
    let rewards = field(config, &["rewards_config", "rewardsConfig"])
        .and_then(|rewards_config| field(rewards_config, &["rewards"]))?
        .as_array()?;

    let total: u64 =
        rewards.iter().filter_map(|reward| field(reward, &["orb_quantity", "orbQuantity"]).and_then(Value::as_u64)).sum();
    (total > 0).then_some(total)
}

fn status(user_status: Option<&Value>) -> QuestStatus {
    let Some(user_status) = user_status else { return QuestStatus::Available };
    let has = |names: &[&str]| field(user_status, names).is_some();

    if has(&["claimed_at", "claimedAt"]) {
        QuestStatus::Claimed
    } else if has(&["completed_at", "completedAt"]) {
        QuestStatus::Completed
    } else if has(&["enrolled_at", "enrolledAt"]) {
        QuestStatus::Enrolled
    } else {
        QuestStatus::Available
    }
}

/// Progress of the first task, when Discord reports one.
fn progress_seconds(user_status: Option<&Value>) -> Option<u64> {
    let progress = field(user_status?, &["progress"])?.as_object()?;
    progress.values().find_map(|task| field(task, &["value"]).and_then(Value::as_u64))
}

fn parse_quest(raw: &Value) -> Option<Quest> {
    let id = text(raw, &["id"])?;
    let config = field(raw, &["config"]).unwrap_or(raw);
    let messages = field(config, &["messages"]);
    let application = field(config, &["application"]);
    let user_status = field(raw, &["user_status", "userStatus"]);

    let game_title = messages.and_then(|m| text(m, &["game_title", "gameTitle"]));
    let name = messages
        .and_then(|m| text(m, &["quest_name", "questName"]))
        .or_else(|| game_title.clone())
        .or_else(|| application.and_then(|a| text(a, &["name"])))
        .unwrap_or_else(|| format!("Quest {id}"));

    Some(Quest {
        game_title,
        publisher: messages.and_then(|m| text(m, &["game_publisher", "gamePublisher"])),
        application_id: application.and_then(|a| text(a, &["id"])),
        reward: reward(config),
        reward_orbs: reward_orbs(config),
        starts_at: timestamp(config, &["starts_at", "startsAt"]),
        expires_at: timestamp(config, &["expires_at", "expiresAt"]),
        tasks: tasks(config),
        status: status(user_status),
        progress_seconds: progress_seconds(user_status),
        completed_at: user_status.and_then(|s| timestamp(s, &["completed_at", "completedAt"])),
        claimed_at: user_status.and_then(|s| timestamp(s, &["claimed_at", "claimedAt"])),
        name,
        id,
    })
}

/// Reads the answer of the quests endpoint: `{ "quests": [...] }` or a bare list.
pub fn parse_quests(answer: &Value) -> Vec<Quest> {
    let list = match answer {
        Value::Array(list) => Some(list),
        other => field(other, &["quests"]).and_then(Value::as_array),
    };
    list.map(|quests| quests.iter().filter_map(parse_quest).collect()).unwrap_or_default()
}

/// The account behind the token, as shown in the sidebar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    /// What Discord shows first: the display name, else the username.
    pub display_name: String,
    /// The `@handle`, without the `@`.
    pub username: String,
    /// Avatar hash; `None` when the account kept the default avatar.
    pub avatar: Option<String>,
}

/// Reads `GET /users/@me`.
pub fn parse_profile(answer: &Value) -> Option<Profile> {
    let username = text(answer, &["username"])?;
    Some(Profile {
        id: text(answer, &["id"])?,
        display_name: text(answer, &["global_name", "globalName"]).unwrap_or_else(|| username.clone()),
        avatar: text(answer, &["avatar"]),
        username,
    })
}

/// Reads the Orbs balance endpoint: `{ "balance": 1234 }`.
pub fn parse_orbs_balance(answer: &Value) -> Option<u64> {
    field(answer, &["balance", "amount"])?.as_u64()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn sample() -> Value {
        json!({
            "quests": [{
                "id": "1234",
                "config": {
                    "starts_at": "2026-10-01T00:00:00.000Z",
                    "expires_at": "2026-11-01T12:30:00+00:00",
                    "application": { "id": "356875221078245376", "name": "Overwatch" },
                    "messages": {
                        "quest_name": "Play Overwatch",
                        "game_title": "Overwatch 2",
                        "game_publisher": "Blizzard"
                    },
                    "task_config": { "tasks": {
                        "PLAY_ON_DESKTOP": { "type": "PLAY_ON_DESKTOP", "target": 900 }
                    } },
                    "rewards_config": { "rewards": [{ "type": 3, "messages": { "name": "Orb Profile Effect" } }] }
                },
                "user_status": {
                    "enrolled_at": "2026-10-05T10:00:00Z",
                    "progress": { "PLAY_ON_DESKTOP": { "value": 120 } }
                }
            }]
        })
    }

    #[test]
    fn reads_a_complete_quest() {
        let quest = parse_quests(&sample()).remove(0);

        assert_eq!(quest.id, "1234");
        assert_eq!(quest.name, "Play Overwatch");
        assert_eq!(quest.game_title.as_deref(), Some("Overwatch 2"));
        assert_eq!(quest.publisher.as_deref(), Some("Blizzard"));
        assert_eq!(quest.application_id.as_deref(), Some("356875221078245376"));
        assert_eq!(quest.reward.as_deref(), Some("Orb Profile Effect"));
        assert_eq!(quest.tasks, [QuestTask { kind: TaskKind::PlayOnDesktop, target_seconds: 900 }]);
        assert_eq!(quest.status, QuestStatus::Enrolled);
        assert_eq!(quest.progress_seconds, Some(120));
        assert_eq!(quest.starts_at, Some(1_790_812_800_000));
        assert_eq!(quest.expires_at, Some(1_793_536_200_000));
    }

    #[test]
    fn accepts_camel_case_names() {
        let answer = json!({ "quests": [{
            "id": "7",
            "config": {
                "expiresAt": "2026-11-01T00:00:00Z",
                "application": { "id": "5" },
                "messages": { "questName": "Camel", "gameTitle": "Game" },
                "taskConfig": { "tasks": { "WATCH_VIDEO": { "type": "WATCH_VIDEO", "target": 30 } } }
            },
            "userStatus": { "completedAt": "2026-10-02T00:00:00Z" }
        }] });

        let quest = parse_quests(&answer).remove(0);
        assert_eq!(quest.name, "Camel");
        assert_eq!(quest.tasks[0].kind, TaskKind::WatchVideo);
        assert_eq!(quest.status, QuestStatus::Completed);
    }

    #[test]
    fn reads_tasks_given_as_a_list() {
        let answer = json!({ "quests": [{ "id": "1", "config": { "task_config_v2": { "tasks": [
            { "type": "PLAY_ON_DESKTOP", "target": 600 },
            { "type": "SOMETHING_NEW", "target": 5 }
        ] } } }] });

        let tasks = parse_quests(&answer).remove(0).tasks;
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].kind, TaskKind::PlayOnDesktop);
        assert_eq!(tasks[1].kind, TaskKind::Other);
    }

    #[test]
    fn a_quest_with_almost_nothing_is_still_listed() {
        let quest = parse_quests(&json!({ "quests": [{ "id": "9" }] })).remove(0);
        assert_eq!(quest.name, "Quest 9");
        assert_eq!(quest.status, QuestStatus::Available);
        assert!(quest.tasks.is_empty());
    }

    #[test]
    fn entries_without_an_id_are_skipped() {
        let answer = json!({ "quests": [{ "config": {} }, { "id": "2" }, "garbage", null] });
        assert_eq!(parse_quests(&answer).len(), 1);
    }

    #[test]
    fn claimed_wins_over_completed_wins_over_enrolled() {
        let status_of = |user_status: Value| {
            parse_quests(&json!({ "quests": [{ "id": "1", "user_status": user_status }] })).remove(0).status
        };
        let date = "2026-10-01T00:00:00Z";

        assert_eq!(status_of(json!({ "enrolled_at": date })), QuestStatus::Enrolled);
        assert_eq!(status_of(json!({ "enrolled_at": date, "completed_at": date })), QuestStatus::Completed);
        assert_eq!(status_of(json!({ "completed_at": date, "claimed_at": date })), QuestStatus::Claimed);
        assert_eq!(status_of(json!({ "enrolled_at": null })), QuestStatus::Available);
    }

    #[test]
    fn accepts_a_bare_list_and_tolerates_other_shapes() {
        assert_eq!(parse_quests(&json!([{ "id": "1" }])).len(), 1);
        assert!(parse_quests(&json!({ "quests": "nope" })).is_empty());
        assert!(parse_quests(&json!(42)).is_empty());
        assert!(parse_quests(&Value::Null).is_empty());
    }

    #[test]
    fn reads_when_a_quest_was_completed_and_claimed() {
        let answer = json!({ "quests": [{ "id": "1", "user_status": {
            "completed_at": "2026-10-02T00:00:00Z",
            "claimedAt": "2026-10-03T00:00:00Z"
        } }] });

        let quest = parse_quests(&answer).remove(0);
        assert_eq!(quest.completed_at, Some(1_790_899_200_000));
        assert_eq!(quest.claimed_at, Some(1_790_985_600_000));
    }

    #[test]
    fn only_available_and_enrolled_quests_are_unfinished() {
        assert!(QuestStatus::Available.is_unfinished());
        assert!(QuestStatus::Enrolled.is_unfinished());
        assert!(!QuestStatus::Completed.is_unfinished());
        assert!(!QuestStatus::Claimed.is_unfinished());
    }

    #[test]
    fn reads_the_orbs_a_quest_grants() {
        let answer = json!({ "quests": [
            { "id": "1", "config": { "rewards_config": { "rewards": [{ "type": 4, "orb_quantity": 700 }] } } },
            { "id": "2", "config": { "rewards_config": { "rewards": [{ "type": 3, "messages": { "name": "Effect" } }] } } },
            { "id": "3" }
        ] });

        let quests = parse_quests(&answer);
        assert_eq!(quests[0].reward_orbs, Some(700));
        assert_eq!(quests[1].reward_orbs, None, "a reward that is not Orbs grants none");
        assert_eq!(quests[2].reward_orbs, None);
    }

    #[test]
    fn reads_the_profile() {
        let profile = parse_profile(&json!({
            "id": "80351110224678912", "username": "nelly", "global_name": "Nelly", "avatar": "8342729096ea3675442027381ff50dfe",
            "email": "never@read.me"
        }))
        .unwrap();

        assert_eq!(profile.display_name, "Nelly");
        assert_eq!(profile.username, "nelly");
        assert_eq!(profile.avatar.as_deref(), Some("8342729096ea3675442027381ff50dfe"));
    }

    #[test]
    fn a_profile_without_display_name_falls_back_to_the_username() {
        let profile = parse_profile(&json!({ "id": "1", "username": "nelly", "global_name": null, "avatar": null })).unwrap();
        assert_eq!((profile.display_name.as_str(), profile.avatar), ("nelly", None));
    }

    #[test]
    fn an_answer_without_identity_is_not_a_profile() {
        assert_eq!(parse_profile(&json!({ "username": "nelly" })), None);
        assert_eq!(parse_profile(&json!([])), None);
    }

    #[test]
    fn reads_the_orbs_balance() {
        assert_eq!(parse_orbs_balance(&json!({ "balance": 1250 })), Some(1250));
        assert_eq!(parse_orbs_balance(&json!({ "balance": "many" })), None);
        assert_eq!(parse_orbs_balance(&json!([])), None);
    }

    #[test]
    fn numeric_ids_are_kept_as_text() {
        let quest = parse_quests(&json!({ "quests": [{ "id": 5, "config": { "application": { "id": 6 } } }] })).remove(0);
        assert_eq!((quest.id.as_str(), quest.application_id.as_deref()), ("5", Some("6")));
    }
}
