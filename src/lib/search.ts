import Fuse from "fuse.js";

import type { Game } from "@/types/domain";

const IGNORED_SYMBOLS = /[©®™]/g;

function stripSymbols(text: string): string {
  return text.replace(IGNORED_SYMBOLS, "");
}

/** Drops ©, ® and ™ so « Game™ » matches « game ». */
export function normalizeQuery(query: string): string {
  return stripSymbols(query).trim();
}

/** Plain-string view of a game, which is what the index actually searches. */
interface SearchEntry {
  game: Game;
  name: string;
  aliases: string[];
  executables: string[];
}

export type GameIndex = Fuse<SearchEntry>;

export function createGameIndex(games: Game[]): GameIndex {
  const entries = games.map<SearchEntry>((game) => ({
    game,
    name: stripSymbols(game.name),
    aliases: game.aliases.map(stripSymbols),
    executables: game.executables.map((executable) => executable.name),
  }));

  return new Fuse(entries, {
    keys: [
      { name: "name", weight: 0.7 },
      { name: "aliases", weight: 0.2 },
      { name: "executables", weight: 0.1 },
    ],
    ignoreDiacritics: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
    threshold: 0.32,
  });
}

const indexes = new WeakMap<Game[], GameIndex>();

/** The index of a catalog, built once per catalog and shared by everyone who searches it. */
export function indexFor(games: Game[]): GameIndex {
  let index = indexes.get(games);
  if (!index) {
    index = createGameIndex(games);
    indexes.set(games, index);
  }
  return index;
}

/**
 * Builds the index and runs a first search now. Both are noticeable on a catalog
 * of ten thousand games, so this is meant to run while the app is idle rather
 * than during the first page change that needs them.
 */
export function warmUpSearch(games: Game[]): void {
  searchGames(indexFor(games), "warm up");
}

/** Best matches first; a query shorter than two characters matches nothing. */
export function searchGames(index: GameIndex, query: string, limit = 30): Game[] {
  const normalized = normalizeQuery(query);
  if (normalized.length < 2) return [];
  return index.search(normalized, { limit }).map((result) => result.item.game);
}
