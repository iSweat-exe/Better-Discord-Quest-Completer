import { invoke } from "@tauri-apps/api/core";

import type {
  AppInfo,
  AppStats,
  Catalog,
  CleanReport,
  DetectionReport,
  DiscordStatus,
  ErrorKind,
  ImportReport,
  LibraryEntry,
  LogEntry,
  PresenceRequest,
  Profile,
  PresenceStatus,
  QuestsResponse,
  SessionInfo,
  Settings,
  SettingsPatch,
  StorageInfo,
  UpdateInfo,
} from "@/types/domain";

/** An error reported by the Rust backend (`{ kind, message }`). */
export class IpcError extends Error {
  readonly kind: ErrorKind | "unknown";

  constructor(kind: ErrorKind | "unknown", message: string) {
    super(message);
    this.name = "IpcError";
    this.kind = kind;
  }
}

function toIpcError(raw: unknown): IpcError {
  if (raw instanceof IpcError) return raw;

  if (typeof raw === "object" && raw !== null && "kind" in raw && "message" in raw) {
    const { kind, message } = raw as { kind: ErrorKind; message: string };
    return new IpcError(kind, String(message));
  }

  return new IpcError("unknown", raw instanceof Error ? raw.message : String(raw));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw toIpcError(raw);
  }
}

/** Typed facade over the Tauri commands. */
export const ipc = {
  getAppInfo: () => call<AppInfo>("get_app_info"),

  getCatalog: (refresh = false) => call<Catalog>("get_catalog", { refresh }),

  getLibrary: () => call<LibraryEntry[]>("get_library"),
  addToLibrary: (gameId: string) => call<LibraryEntry[]>("add_to_library", { gameId }),
  removeFromLibrary: (gameId: string) => call<LibraryEntry[]>("remove_from_library", { gameId }),
  exportLibrary: () => call<string>("export_library"),
  importLibrary: (json: string) => call<ImportReport>("import_library", { json }),

  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (patch: SettingsPatch) => call<Settings>("update_settings", { patch }),

  listSessions: () => call<SessionInfo[]>("list_sessions"),
  startSession: (gameId: string, executable: string, targetMinutes?: number) =>
    call<SessionInfo>("start_session", { gameId, executable, targetMinutes: targetMinutes ?? null }),
  stopSession: (sessionId: string) => call<void>("stop_session", { sessionId }),
  stopAllSessions: () => call<void>("stop_all_sessions"),

  getQuestsConnection: () => call<boolean>("get_quests_connection"),
  /** The token is sent once, to be checked and stored; it never comes back. */
  connectQuests: (token: string) => call<QuestsResponse>("connect_quests", { token }),
  /** The quests as last seen: available before any request to Discord. */
  getCachedQuests: () => call<QuestsResponse | null>("get_cached_quests"),
  refreshQuests: () => call<QuestsResponse>("refresh_quests"),
  getAppStats: () => call<AppStats>("get_app_stats"),
  getProfile: () => call<Profile>("get_profile"),
  getOrbsBalance: () => call<number>("get_orbs_balance"),
  disconnectQuests: () => call<void>("disconnect_quests"),

  /** `null` means the app is up to date. */
  checkForUpdate: () => call<UpdateInfo | null>("check_for_update"),
  getPendingUpdate: () => call<UpdateInfo | null>("get_pending_update"),
  /** Downloads, installs and restarts the app: it only returns if that failed. */
  installUpdate: () => call<void>("install_update"),

  getDiscordStatus: () => call<DiscordStatus>("get_discord_status"),
  checkDetection: (sessionId: string) => call<DetectionReport>("check_detection", { sessionId }),
  revealExecutable: (gameId: string, executable: string) =>
    call<void>("reveal_executable", { gameId, executable }),

  getStorageInfo: () => call<StorageInfo>("get_storage_info"),
  cleanStorage: () => call<CleanReport>("clean_storage"),
  openGamesFolder: () => call<void>("open_games_folder"),

  getLogs: () => call<LogEntry[]>("get_logs"),
  clearLogs: () => call<void>("clear_logs"),

  getPresenceStatus: () => call<PresenceStatus>("get_presence_status"),
  publishPresence: (request: PresenceRequest) =>
    call<PresenceStatus>("publish_presence", { request }),
  clearPresence: () => call<PresenceStatus>("clear_presence"),

  windowReady: () => call<void>("window_ready"),
  hideToTray: () => call<void>("hide_to_tray"),
  quitApp: () => call<void>("quit_app"),
};
