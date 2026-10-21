/**
 * Types mirroring the Rust backend (`src-tauri/src`). Fields are camelCase,
 * Discord application ids are strings (they overflow JavaScript numbers).
 */

export type Support = "ok" | "otherPlatform" | "invalidPath" | "notExe";

export interface Executable {
  name: string;
  os: string;
  isLauncher: boolean;
  support: Support;
}

export interface Game {
  id: string;
  name: string;
  aliases: string[];
  executables: Executable[];
  iconHash: string | null;
  themes: string[];
}

export interface LibraryEntry {
  game: Game;
  /** Unix timestamp in milliseconds. */
  addedAt: number;
  /** When the game was last started (Unix milliseconds). */
  lastPlayedAt: number | null;
  /** Total simulated playtime, in seconds. */
  totalSeconds: number;
}

export type CatalogSource = "discord" | "cache" | "bundled";

export interface Catalog {
  games: Game[];
  source: CatalogSource;
  /** Unix timestamp in milliseconds; unknown for the bundled snapshot. */
  fetchedAt: number | null;
  refreshError: string | null;
  platform: string;
}

/** Whether the quest timer waits for Discord to notice the game. */
export type DetectionPhase = "off" | "waiting" | "detected" | "unverifiable";

export interface SessionInfo {
  id: string;
  gameId: string;
  gameName: string;
  executable: string;
  /** Full path of the fake executable that is running. */
  path: string;
  pid: number;
  /** Unix timestamp in milliseconds. */
  startedAt: number;
  targetSeconds: number;
  detection: DetectionPhase;
  /** Unix milliseconds of the first sign that Discord noticed the game. */
  detectedAt: number | null;
}

export type Language = "auto" | "fr" | "en";
export type Theme = "system" | "light" | "dark";

export type RunnerWindow = "normal" | "minimized" | "hidden";

export interface Settings {
  language: Language;
  theme: Theme;
  questDurationMinutes: number;
  notifyOnComplete: boolean;
  notifyNewQuests: boolean;
  autoCheckUpdates: boolean;
  closeToTray: boolean;
  waitForDetection: boolean;
  runnerWindow: RunnerWindow;
  autoStopOnComplete: boolean;
  launchAtStartup: boolean;
}

export type SettingsPatch = Partial<Settings>;

export interface AppInfo {
  version: string;
  platform: string;
  runnerAvailable: boolean;
  dataDir: string;
}

export interface DiscordStatus {
  running: boolean;
  /** The official client found, e.g. "Discord". */
  client: string | null;
  /** A client that is running but cannot detect games (Vesktop…). */
  unsupportedClient: string | null;
}

export type DetectionState = "detected" | "reacted" | "waiting" | "logUnavailable";

export interface DetectionReport {
  state: DetectionState;
  /** Unix milliseconds of the first sign of detection. */
  detectedAt: number | null;
}

export interface ImportReport {
  added: number;
  alreadyPresent: number;
  unknown: number;
}

export type TaskKind =
  | "playOnDesktop"
  | "playOnXbox"
  | "playOnPlaystation"
  | "watchVideo"
  | "watchVideoOnMobile"
  | "streamOnDesktop"
  | "playActivity"
  | "other";

export interface QuestTask {
  kind: TaskKind;
  /** What the quest asks for, in seconds. */
  targetSeconds: number;
}

export type QuestStatus = "available" | "enrolled" | "completed" | "claimed";

export interface Quest {
  id: string;
  name: string;
  gameTitle: string | null;
  publisher: string | null;
  /** Discord application id of the game: matches catalog game ids. */
  applicationId: string | null;
  reward: string | null;
  /** Orbs the reward grants, when it is Orbs. */
  rewardOrbs: number | null;
  /** Unix milliseconds. */
  startsAt: number | null;
  expiresAt: number | null;
  tasks: QuestTask[];
  status: QuestStatus;
  /** Progress reported by Discord for the first task, in seconds. */
  progressSeconds: number | null;
  /** Unix milliseconds; with `claimedAt`, the reward history. */
  completedAt: number | null;
  claimedAt: number | null;
}

/** A quest the app helped complete (see `stats.rs`). */
export interface CompletedQuest {
  questId: string;
  name: string;
  orbs: number | null;
  /** Unix milliseconds. */
  completedAt: number;
}

/** What the app itself helped complete; the account's own totals come from the quests. */
export interface AppStats {
  questsCompleted: number;
  orbsEarned: number;
  /** The latest ones, newest first. */
  recent: CompletedQuest[];
}

/** Discord itself marked this quest as completed (see `quest_watch.rs`). */
export interface QuestDone {
  questId: string;
  name: string;
}

/** A newer version of the app (see `updates.rs`). */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** The release notes, as written on the release. */
  notes: string | null;
  /** Unix milliseconds. */
  publishedAt: number | null;
}

export interface DownloadProgress {
  downloaded: number;
  /** Unknown when the server does not announce the size. */
  total: number | null;
}

/** The Discord account behind the saved token (public identity only). */
export interface Profile {
  id: string;
  /** What Discord shows first: the display name, else the username. */
  displayName: string;
  /** The `@handle`, without the `@`. */
  username: string;
  /** Avatar hash; `null` when the account kept the default avatar. */
  avatar: string | null;
}

export interface QuestsResponse {
  quests: Quest[];
  /** Unix milliseconds. */
  fetchedAt: number;
  /** Discord's answer as received (it never contains the token). */
  rawJson: string;
}

export interface StorageInfo {
  path: string;
  gameCount: number;
  totalBytes: number;
}

export interface CleanReport {
  removedGames: number;
  freedBytes: number;
  skipped: number;
}

export type LogLevel = "info" | "warning" | "error";

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  message: string;
}

export type PresenceKind = "playing" | "listening" | "watching" | "competing";

export interface PresenceRequest {
  gameId: string;
  details?: string;
  state?: string;
  elapsedMinutes?: number;
  kind: PresenceKind;
}

export interface PresenceStatus {
  connected: boolean;
  gameId: string | null;
  gameName: string | null;
}

/** Error kinds the backend can report (see `error.rs`). */
export type ErrorKind =
  | "invalidGameId"
  | "gameNotFound"
  | "invalidExecutable"
  | "executableUnavailable"
  | "unsupportedPlatform"
  | "alreadyRunning"
  | "sessionNotFound"
  | "gameRunning"
  | "io"
  | "tokenMissing"
  | "tokenInvalid"
  | "tokenFormat"
  | "network"
  | "update"
  | "catalog"
  | "discordNotRunning"
  | "presence"
  | "internal";
