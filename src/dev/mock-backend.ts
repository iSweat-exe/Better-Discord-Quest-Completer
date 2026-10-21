/**
 * A fake Tauri backend for running the UI in a plain browser (`npm run dev`).
 *
 * It is only loaded in development, when `__TAURI_INTERNALS__` is missing, and
 * serves the real bundled game list so searching feels exactly like the app.
 * Library and settings persist in `localStorage` between reloads.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import { EVENTS } from "@/lib/events";
import type {
  Catalog,
  Executable,
  Game,
  LibraryEntry,
  LogEntry,
  LogLevel,
  PresenceStatus,
  SessionInfo,
  QuestsResponse,
  Settings,
  Support,
  UpdateInfo,
} from "@/types/domain";

interface RawGame {
  id: string;
  name: string;
  aliases?: string[];
  executables: { name: string; os: string; is_launcher?: boolean }[];
  icon_hash?: string;
  themes?: string[];
}

const PLATFORM = "win32";
const FORBIDDEN = /[<>:"|?*]/;

/** Mirrors the Rust validation: control characters are never allowed in a name. */
const hasControlCharacter = (text: string) => [...text].some((char) => char.charCodeAt(0) < 32);

/** What the real backend rejects with: `{ kind, message }`. */
class MockError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** Arguments sent by `ipc.ts`; each command only reads the ones it receives. */
interface MockArgs {
  gameId: string;
  executable: string;
  sessionId: string;
  token: string;
  patch: Partial<Settings>;
  request: { gameId: string };
}

function supportOf(executable: { name: string; os: string }): Support {
  if (executable.os !== PLATFORM) return "otherPlatform";
  const segments = executable.name.split(/[\\/]/);
  const unsafe = segments.some(
    (segment) => segment === "" || segment === "." || segment === ".." || FORBIDDEN.test(segment) || hasControlCharacter(segment) || /[. ]$/.test(segment),
  );
  if (unsafe) return "invalidPath";
  return /\.exe$/i.test(executable.name) ? "ok" : "notExe";
}

function toGame(raw: RawGame): Game {
  return {
    id: raw.id,
    name: raw.name,
    aliases: raw.aliases ?? [],
    iconHash: raw.icon_hash ?? null,
    themes: raw.themes ?? [],
    executables: raw.executables.map<Executable>((executable) => ({
      name: executable.name,
      os: executable.os,
      isLauncher: executable.is_launcher ?? false,
      support: supportOf(executable),
    })),
  };
}

function load<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(`dqc-mock:${key}`);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`dqc-mock:${key}`, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode): the mock then simply forgets.
  }
}

/** Demo quests: real catalog ids, so the "add this game" flow works in the browser. */
function demoQuests(): QuestsResponse {
  const day = 86_400_000;
  const now = Date.now();
  const play = (seconds: number) => [{ kind: "playOnDesktop" as const, targetSeconds: seconds }];

  return {
    fetchedAt: now,
    rawJson: "{}",
    quests: [
      { id: "1", name: "Play Overwatch", gameTitle: "Overwatch", publisher: "Blizzard", applicationId: "356875221078245376", reward: "Orb Profile Effect", rewardOrbs: null, startsAt: now - 3 * day, expiresAt: now + 4 * day, tasks: play(900), status: "available", progressSeconds: null, completedAt: null, claimedAt: null },
      { id: "2", name: "Fortnite quest", gameTitle: "Fortnite", publisher: "Epic Games", applicationId: "1402418703554842694", reward: "Avatar Decoration", rewardOrbs: null, startsAt: now - day, expiresAt: now + 9 * day, tasks: play(1800), status: "enrolled", progressSeconds: 420, completedAt: null, claimedAt: null },
      { id: "3", name: "Watch the trailer", gameTitle: null, publisher: null, applicationId: null, reward: "100 Orbs", rewardOrbs: 100, startsAt: null, expiresAt: now + 2 * day, tasks: [{ kind: "watchVideo", targetSeconds: 30 }], status: "available", progressSeconds: null, completedAt: null, claimedAt: null },
      { id: "4", name: "Mystery game", gameTitle: "Zzzzzz Qqqqqq", publisher: null, applicationId: "999", reward: null, rewardOrbs: null, startsAt: null, expiresAt: now + 5 * day, tasks: play(900), status: "available", progressSeconds: null, completedAt: null, claimedAt: null },
      { id: "5", name: "Done last week", gameTitle: "Roblox", publisher: null, applicationId: "363445589247131668", reward: "Badge", rewardOrbs: null, startsAt: null, expiresAt: now - day, tasks: play(900), status: "completed", progressSeconds: 900, completedAt: now - 6 * day, claimedAt: null },
      { id: "6", name: "Claimed last month", gameTitle: "Fortnite", publisher: "Epic Games", applicationId: "1402418703554842694", reward: "Orb Profile Effect", rewardOrbs: null, startsAt: null, expiresAt: now - 20 * day, tasks: play(900), status: "claimed", progressSeconds: 900, completedAt: now - 25 * day, claimedAt: now - 24 * day },
    ],
  };
}

const DEMO_UPDATE: UpdateInfo = {
  version: "2.1.0",
  currentVersion: "2.0.0",
  notes: "- Orbs balance and profile page\n- Animated icons\n- Faster page changes",
  publishedAt: Date.now() - 2 * 86_400_000,
};

export function installMockBackend(): void {
  mockWindows("main");

  let settings = load<Settings>("settings", {
    language: "auto",
    theme: "system",
    questDurationMinutes: 15,
    notifyOnComplete: true,
    notifyNewQuests: true,
    autoCheckUpdates: true,
    closeToTray: false,
    waitForDetection: true,
    runnerWindow: "normal",
    autoStopOnComplete: false,
    launchAtStartup: false,
  });
  let library = load<LibraryEntry[]>("library", []);
  let sessions: SessionInfo[] = [];
  let questsConnected = load<boolean>("quests", false);
  let presence: PresenceStatus = { connected: false, gameId: null, gameName: null };
  let catalog: Promise<Catalog> | undefined;
  let nextLogId = 1;
  const logs: LogEntry[] = [];
  const timers = new Map<string, number>();

  const log = (level: LogLevel, message: string) => {
    const entry: LogEntry = { id: nextLogId++, timestamp: Date.now(), level, message };
    logs.push(entry);
    void emit(EVENTS.appLog, entry);
  };

  const broadcast = () => emit(EVENTS.sessionsChanged, sessions);

  const loadCatalog = () =>
    (catalog ??= import("../../src-tauri/assets/gamelist.min.json").then(({ default: raw }) => {
      log("info", "Game list loaded from the bundled snapshot (mock backend).");
      return {
        games: (raw as RawGame[]).map(toGame),
        source: "bundled",
        fetchedAt: null,
        refreshError: null,
        platform: PLATFORM,
      } satisfies Catalog;
    }));

  const findGame = async (gameId: string): Promise<Game> => {
    const game = library.find((entry) => entry.game.id === gameId)?.game ?? (await loadCatalog()).games.find((item) => item.id === gameId);
    if (!game) throw new MockError("gameNotFound", `game ${gameId} was not found`);
    return game;
  };

  mockIPC(
    async (command, payload) => {
      const args = (payload ?? {}) as unknown as MockArgs;

      switch (command) {
        case "get_app_info":
          return { version: "2.0.0-dev", platform: PLATFORM, runnerAvailable: true, dataDir: "C:\\Users\\you\\AppData\\Local\\dev.questcompleter.app" };

        case "get_catalog":
          return loadCatalog();

        case "get_library":
          return library;

        case "add_to_library": {
          const game = await findGame(args.gameId);
          if (!library.some((entry) => entry.game.id === game.id)) {
            library = [...library, { game, addedAt: Date.now(), lastPlayedAt: null, totalSeconds: 0 }];
            save("library", library);
            log("info", `${game.name} added to the library.`);
          }
          return library;
        }

        case "remove_from_library": {
          if (sessions.some((session) => session.gameId === args.gameId)) {
            throw new MockError("gameRunning", "game is currently running");
          }
          library = library.filter((entry) => entry.game.id !== args.gameId);
          save("library", library);
          return library;
        }

        case "get_settings":
          return settings;

        case "update_settings":
          settings = { ...settings, ...args.patch };
          save("settings", settings);
          return settings;

        case "list_sessions":
          return sessions;

        case "start_session": {
          const game = await findGame(args.gameId);
          const executable = game.executables.find((item) => item.name === args.executable);
          if (executable?.support !== "ok") throw new MockError("executableUnavailable", "executable unavailable");

          const id = `${game.id}:${executable.name.toLowerCase()}`;
          if (sessions.some((session) => session.id === id)) throw new MockError("alreadyRunning", "already running");

          const session: SessionInfo = {
            id,
            gameId: game.id,
            gameName: game.name,
            executable: executable.name,
            path: `C:\\Users\\you\\AppData\\Local\\dev.questcompleter.app\\games\\${game.id}\\${executable.name}`,
            pid: 1000 + Math.floor(Math.random() * 9000),
            startedAt: Date.now(),
            targetSeconds: settings.questDurationMinutes * 60,
            detection: settings.waitForDetection ? "waiting" : "off",
            detectedAt: null,
          };
          sessions = [...sessions, session];
          if (session.detection === "waiting") {
            // Discord notices the game a little while after the launch.
            window.setTimeout(() => {
              sessions = sessions.map((item) =>
                item.id === session.id ? { ...item, detection: "detected", detectedAt: Date.now() } : item,
              );
              void broadcast();
            }, 15_000);
          }
          timers.set(
            id,
            window.setTimeout(() => {
              void emit(EVENTS.sessionCompleted, session);
            }, session.targetSeconds * 1000),
          );
          log("info", `${game.name} started as ${executable.name} (pid ${session.pid}).`);
          await broadcast();
          return session;
        }

        case "stop_session": {
          const session = sessions.find((item) => item.id === args.sessionId);
          if (!session) throw new MockError("sessionNotFound", "session does not exist");
          window.clearTimeout(timers.get(session.id));
          sessions = sessions.filter((item) => item.id !== session.id);
          log("info", `${session.gameName} stopped.`);
          await broadcast();
          return null;
        }

        case "stop_all_sessions":
          timers.forEach((timer) => {
            window.clearTimeout(timer);
          });
          sessions = [];
          await broadcast();
          return null;

        case "get_quests_connection":
          return questsConnected;

        case "connect_quests":
          // Any plausible-looking value works here: this is only a demo backend.
          if (String(args.token).trim().length < 20) throw new MockError("tokenFormat", "not a token");
          questsConnected = true;
          save("quests", true);
          return demoQuests();

        case "get_cached_quests":
          return questsConnected ? demoQuests() : null;

        case "refresh_quests":
          if (!questsConnected) throw new MockError("tokenMissing", "no token");
          return demoQuests();

        case "get_app_stats":
          return {
            questsCompleted: 2,
            orbsEarned: 1200,
            recent: [
              { questId: "6", name: "Claimed last month", orbs: 700, completedAt: Date.now() - 3 * 86_400_000 },
              { questId: "5", name: "Done last week", orbs: 500, completedAt: Date.now() - 9 * 86_400_000 },
            ],
          };

        case "get_profile":
          if (!questsConnected) throw new MockError("tokenMissing", "no token");
          return { id: "80351110224678912", displayName: "Nelly", username: "nelly", avatar: null };

        case "get_orbs_balance":
          if (!questsConnected) throw new MockError("tokenMissing", "no token");
          return 1250;

        case "disconnect_quests":
          questsConnected = false;
          save("quests", false);
          return null;

        case "check_for_update":
          // The demo always has something newer, so the whole flow can be tried in a browser.
          return DEMO_UPDATE;

        case "get_pending_update":
          return null;

        case "install_update": {
          for (let downloaded = 0; downloaded <= 100; downloaded += 5) {
            await emit(EVENTS.updateProgress, { downloaded, total: 100 });
            await new Promise((resolve) => window.setTimeout(resolve, 120));
          }
          throw new MockError("update", "the demo cannot restart itself");
        }

        case "get_discord_status":
          return { running: true, client: "Discord", unsupportedClient: null };

        case "check_detection": {
          const session = sessions.find((item) => item.id === args.sessionId);
          if (!session) throw new MockError("sessionNotFound", "session does not exist");
          const seconds = (Date.now() - session.startedAt) / 1000;
          return seconds > 40
            ? { state: "detected", detectedAt: session.startedAt + 38_000 }
            : { state: "waiting", detectedAt: null };
        }

        case "reveal_executable":
        case "window_ready":
          return null;

        case "export_library":
          return JSON.stringify({ version: 1, games: library.map((entry) => ({ id: entry.game.id, name: entry.game.name })) }, null, 2);

        case "import_library":
          return { added: 0, alreadyPresent: library.length, unknown: 0 };

        case "get_storage_info":
          return { path: "C:\\Users\\you\\AppData\\Local\\dev.questcompleter.app\\games", gameCount: library.length, totalBytes: library.length * 221_696 };

        case "clean_storage":
          return { removedGames: library.length, freedBytes: library.length * 221_696, skipped: 0 };

        case "open_games_folder":
        case "hide_to_tray":
        case "quit_app":
          return null;

        case "get_logs":
          return logs;

        case "clear_logs":
          logs.length = 0;
          return null;

        case "get_presence_status":
          return presence;

        case "publish_presence": {
          const game = await findGame(args.request.gameId);
          presence = { connected: true, gameId: game.id, gameName: game.name };
          log("info", `Rich Presence published for ${game.name}.`);
          return presence;
        }

        case "clear_presence":
          presence = { connected: false, gameId: null, gameName: null };
          return presence;

        default:
          // Window and event plugin calls are handled by the mocks themselves.
          return undefined;
      }
    },
    { shouldMockEvents: true },
  );
}
