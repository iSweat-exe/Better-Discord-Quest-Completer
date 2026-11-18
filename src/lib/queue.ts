import { firstPlayable } from "@/lib/executables";
import { playTask, questState, remainingSeconds, taskMinutes, type QuestGame } from "@/lib/quests";
import type { Quest, QueueItem, QueueStatus } from "@/types/domain";

/**
 * The queue item that would play `quest`: an accepted, unfinished quest that asks
 * to play on a PC, whose game is known and can run here. Discord's own progress
 * decides the duration: only what is still missing is played.
 */
export function queueItemFor(quest: Quest, games: readonly QuestGame[], now: number): QueueItem | null {
  if (questState(quest, now) !== "inProgress") return null;
  const task = playTask(quest);
  if (!task) return null;

  const remaining = remainingSeconds(quest);
  // Discord already has the playtime: it is validating, there is nothing left to play.
  if (remaining === 0) return null;
  const minutes = remaining === null ? taskMinutes(task) : Math.max(1, Math.ceil(remaining / 60));

  // The game the quest names first, then a title match.
  const ordered = [...games].sort((a, b) => Number(b.match === "id") - Number(a.match === "id"));
  for (const { game } of ordered) {
    const executable = firstPlayable(game);
    if (executable) {
      return {
        questId: quest.id,
        questName: quest.name,
        gameId: game.id,
        gameName: game.name,
        executable: executable.name,
        minutes,
      };
    }
  }
  return null;
}

/** Every quest the queue can play, the one expiring first at the front. */
export function planQueue(
  quests: readonly Quest[],
  resolved: ReadonlyMap<string, readonly QuestGame[]>,
  now: number,
): QueueItem[] {
  return [...quests]
    .sort((a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY))
    .flatMap((quest) => {
      const item = queueItemFor(quest, resolved.get(quest.id) ?? [], now);
      return item ? [item] : [];
    });
}

/** Games the queue runs at the same time (`MAX_PLAYING` in `queue.rs`). */
export const MAX_PLAYING = 10;
/** Roughly how long Discord takes to notice a game it scans for (15 to 60 s). */
const DETECTION_MINUTES = 1;

/**
 * How long a queue of these quests takes: its games run together, so the
 * longest quest sets the pace (batches of `MAX_PLAYING` beyond that), plus the
 * minute Discord takes to notice the games.
 */
export function estimatedMinutes(items: readonly { minutes: number }[]): number {
  if (items.length === 0) return 0;
  const sorted = items.map((item) => item.minutes).sort((a, b) => b - a);
  let total = 0;
  for (let start = 0; start < sorted.length; start += MAX_PLAYING) total += sorted[start] ?? 0;
  return total + DETECTION_MINUTES;
}

/** Whether something is still to be played. */
export function isQueueActive(status: QueueStatus): boolean {
  return status.playing.length > 0 || status.pending.length > 0;
}

/** The quests already queued (playing or waiting). */
export function queuedQuestIds(status: QueueStatus): Set<string> {
  const ids = new Set(status.pending.map((item) => item.questId));
  for (const playing of status.playing) ids.add(playing.item.questId);
  return ids;
}

export const EMPTY_QUEUE: QueueStatus = { playing: [], pending: [], done: [] };
