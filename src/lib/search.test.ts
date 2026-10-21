import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { Game } from "@/types/domain";

import { createGameIndex, normalizeQuery, searchGames } from "./search";

const game = (id: string, name: string, aliases: string[] = [], exe = "game.exe"): Game => ({
  id,
  name,
  aliases,
  executables: [{ name: exe, os: "win32", isLauncher: false, support: "ok" }],
  iconHash: null,
  themes: [],
});

describe("normalizeQuery", () => {
  it("removes trademark symbols and trims", () => {
    expect(normalizeQuery("  Overwatch® 2™ ")).toBe("Overwatch 2");
  });
});

describe("searchGames", () => {
  const index = createGameIndex([
    game("1", "Overwatch"),
    game("2", "World of Warcraft™", ["WoW"], "wow.exe"),
    game("3", "Pokémon Legends"),
    game("4", "Counter-Strike 2", ["CS2"], "cs2.exe"),
  ]);

  it("returns nothing for queries shorter than two characters", () => {
    expect(searchGames(index, "o")).toEqual([]);
    expect(searchGames(index, "   ")).toEqual([]);
  });

  it("finds a game by name, ignoring case", () => {
    expect(searchGames(index, "overwatch")[0]?.id).toBe("1");
  });

  it("tolerates typos", () => {
    expect(searchGames(index, "overwtach")[0]?.id).toBe("1");
  });

  it("matches aliases and executable names", () => {
    expect(searchGames(index, "cs2")[0]?.id).toBe("4");
    expect(searchGames(index, "wow.exe")[0]?.id).toBe("2");
  });

  it("ignores trademark symbols and diacritics", () => {
    expect(searchGames(index, "world of warcraft")[0]?.id).toBe("2");
    expect(searchGames(index, "pokemon")[0]?.id).toBe("3");
  });

  it("honors the result limit", () => {
    expect(searchGames(index, "ar", 1).length).toBeLessThanOrEqual(1);
  });
});

describe("searchGames on the bundled catalog", () => {
  const path = resolve(process.cwd(), "src-tauri/assets/gamelist.min.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    id: string;
    name: string;
    aliases?: string[];
    executables: { name: string; os: string }[];
  }[];

  const games: Game[] = raw.map((entry) => ({
    id: entry.id,
    name: entry.name,
    aliases: entry.aliases ?? [],
    executables: entry.executables.map((exe) => ({ ...exe, isLauncher: false, support: "ok" as const })),
    iconHash: null,
    themes: [],
  }));

  it("indexes and queries ten thousand games quickly", () => {
    const startedAt = performance.now();
    const index = createGameIndex(games);
    const indexed = performance.now();
    const results = searchGames(index, "minecraft");
    const searched = performance.now();

    expect(games.length).toBeGreaterThan(5000);
    expect(results.some((result) => result.name.toLowerCase().includes("minecraft"))).toBe(true);
    expect(indexed - startedAt).toBeLessThan(3000);
    expect(searched - indexed).toBeLessThan(500);
  });

  it("ranks an exact name first", () => {
    const index = createGameIndex(games);
    expect(searchGames(index, "Overwatch")[0]?.name).toBe("Overwatch");
  });
});
