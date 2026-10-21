import type { SessionInfo } from "@/types/domain";

/**
 * When the quest timer of a session started, or `null` while it still waits
 * for Discord to notice the game.
 *
 * Mirrors `SessionInfo::timer_started_at` in the backend.
 */
export function timerStartedAt(session: SessionInfo): number | null {
  switch (session.detection) {
    case "waiting":
      return null;
    case "detected":
      return session.detectedAt;
    default:
      // `off`, `unverifiable` — and a backend that predates detection tracking.
      return session.startedAt;
  }
}

/** Seconds on the quest timer, or `null` while it waits. Never negative. */
export function timerElapsedSeconds(session: SessionInfo, now: number): number | null {
  const start = timerStartedAt(session);
  return start === null ? null : Math.max(0, (now - start) / 1000);
}
