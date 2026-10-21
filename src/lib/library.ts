import type { LibraryEntry, SessionInfo } from "@/types/domain";

import { firstPlayable } from "./executables";

/**
 * Most recently played first, then most recently added (a game never launched
 * sorts by when it was added).
 *
 * Running games deliberately do not float to the top: the list would reshuffle
 * under the cursor each time a game starts. The sidebar and the rows show them.
 */
export function sortLibrary(entries: LibraryEntry[]): LibraryEntry[] {
  return entries.toSorted((a, b) => {
    const playedA = a.lastPlayedAt ?? 0;
    const playedB = b.lastPlayedAt ?? 0;
    if (playedA !== playedB) return playedB - playedA;
    return b.addedAt - a.addedAt;
  });
}

/** Games a one-click "launch everything" can start: playable and not running yet. */
export function launchableGames(entries: LibraryEntry[], sessions: SessionInfo[]): LibraryEntry[] {
  return entries.filter(
    (entry) =>
      firstPlayable(entry.game) !== undefined && !sessions.some((session) => session.gameId === entry.game.id),
  );
}

export function matchesFilter(entry: LibraryEntry, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return (
    entry.game.name.toLowerCase().includes(needle) ||
    entry.game.aliases.some((alias) => alias.toLowerCase().includes(needle))
  );
}
