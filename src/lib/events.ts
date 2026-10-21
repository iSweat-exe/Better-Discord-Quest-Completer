import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Catalog, DownloadProgress, LogEntry, QuestDone, QuestsResponse, SessionInfo, UpdateInfo, VideoEnded, VideoProgress } from "@/types/domain";

/** Event names emitted by the backend (see `state.rs` and `logger.rs`). */
export const EVENTS = {
  sessionsChanged: "sessions-changed",
  sessionCompleted: "session-completed",
  closeRequested: "close-requested",
  libraryChanged: "library-changed",
  catalogUpdated: "catalog-updated",
  questsUpdated: "quests-updated",
  questsDisconnected: "quests-disconnected",
  questDone: "quest-done",
  questVideoProgress: "quest-video-progress",
  questVideoEnded: "quest-video-ended",
  statsChanged: "stats-changed",
  updateAvailable: "update-available",
  updateProgress: "update-progress",
  appLog: "app-log",
} as const;

interface EventPayloads {
  [EVENTS.sessionsChanged]: SessionInfo[];
  [EVENTS.sessionCompleted]: SessionInfo;
  [EVENTS.closeRequested]: number;
  [EVENTS.libraryChanged]: null;
  [EVENTS.catalogUpdated]: Catalog;
  [EVENTS.questsUpdated]: QuestsResponse;
  [EVENTS.questsDisconnected]: null;
  [EVENTS.questDone]: QuestDone;
  [EVENTS.questVideoProgress]: VideoProgress;
  [EVENTS.questVideoEnded]: VideoEnded;
  [EVENTS.statsChanged]: null;
  [EVENTS.updateAvailable]: UpdateInfo;
  [EVENTS.updateProgress]: DownloadProgress;
  [EVENTS.appLog]: LogEntry;
}

/**
 * Subscribes to a backend event and returns a synchronous cleanup function,
 * which fits `useEffect` even though registration itself is asynchronous.
 */
export function subscribe<E extends keyof EventPayloads>(
  event: E,
  handler: (payload: EventPayloads[E]) => void,
): () => void {
  let unlisten: UnlistenFn | undefined;
  let cancelled = false;

  void listen<EventPayloads[E]>(event, (message) => {
    handler(message.payload);
  }).then((fn) => {
    // The component may have unmounted while the registration was in flight.
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
