import { describe, expect, it } from "vitest";

import type { Game, LibraryEntry, SessionInfo } from "@/types/domain";

import { launchableGames, matchesFilter, sortLibrary } from "./library";

const entry = (id: string, addedAt: number, lastPlayedAt: number | null = null, playable = true): LibraryEntry => {
  const game: Game = {
    id,
    name: `Game ${id}`,
    aliases: [],
    iconHash: null,
    themes: [],
    executables: [{ name: "g.exe", os: "win32", isLauncher: false, support: playable ? "ok" : "otherPlatform" }],
  };
  return { game, addedAt, lastPlayedAt, totalSeconds: 0 };
};

const session = (gameId: string, startedAt: number): SessionInfo => ({
  id: `${gameId}:g.exe`,
  gameId,
  gameName: `Game ${gameId}`,
  executable: "g.exe",
  path: "C:\\g.exe",
  pid: 1,
  startedAt,
  targetSeconds: 900,
  detection: "off",
  detectedAt: null,
});

const ids = (entries: LibraryEntry[]) => entries.map((item) => item.game.id);

describe("sortLibrary", () => {
  it("orders by most recent play, then most recent addition", () => {
    const entries = [entry("a", 1, 50), entry("b", 2), entry("c", 3, 90), entry("d", 9)];
    expect(ids(sortLibrary(entries))).toEqual(["c", "a", "d", "b"]);
  });

  it("does not mutate its input", () => {
    const entries = [entry("a", 1), entry("b", 2)];
    sortLibrary(entries);
    expect(ids(entries)).toEqual(["a", "b"]);
  });
});

describe("launchableGames", () => {
  it("skips unplayable and already running games", () => {
    const entries = [entry("a", 1), entry("b", 2, null, false), entry("c", 3)];
    expect(ids(launchableGames(entries, [session("c", 1)]))).toEqual(["a"]);
  });
});

describe("matchesFilter", () => {
  it("matches names and aliases case-insensitively", () => {
    const base = entry("a", 1);
    const withAlias = { ...base, game: { ...base.game, name: "Overwatch", aliases: ["OW2"] } };
    expect(matchesFilter(withAlias, "WATCH")).toBe(true);
    expect(matchesFilter(withAlias, "ow2")).toBe(true);
    expect(matchesFilter(withAlias, "zzz")).toBe(false);
  });

  it("matches everything for a blank filter", () => {
    expect(matchesFilter(entry("a", 1), "   ")).toBe(true);
  });
});
