import { describe, expect, it } from "vitest";

import type { Game, Quest } from "@/types/domain";

import {
  expiringSoon,
  filterByKind,
  isOpen,
  orbsAtStake,
  playTask,
  questState,
  remainingSeconds,
  resolveQuestGame,
  resolveQuestGames,
  sameTitle,
  settledAt,
  sortOpenQuests,
  sortQuests,
  taskMinutes,
} from "./quests";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const quest = (overrides: Partial<Quest> = {}): Quest => ({
  id: "q",
  name: "Quest",
  gameTitle: null,
  publisher: null,
  applicationId: null,
  eligibleApplicationIds: [],
  anyTask: false,
  reward: null,
  rewardOrbs: null,
  startsAt: null,
  expiresAt: NOW + DAY,
  tasks: [{ kind: "playOnDesktop", targetSeconds: 900 }],
  status: "available",
  progressSeconds: null,
  completedAt: null,
  claimedAt: null,
  ...overrides,
});

const game = (id: string, name: string): Game => ({
  id,
  name,
  aliases: [],
  executables: [{ name: "g.exe", os: "win32", isLauncher: false, support: "ok" }],
  iconHash: null,
  themes: [],
});

describe("questState", () => {
  it("follows the status", () => {
    expect(questState(quest(), NOW)).toBe("available");
    expect(questState(quest({ status: "enrolled" }), NOW)).toBe("inProgress");
    expect(questState(quest({ status: "completed" }), NOW)).toBe("completed");
    expect(questState(quest({ status: "claimed" }), NOW)).toBe("claimed");
  });

  it("marks an unfinished quest past its deadline as expired", () => {
    expect(questState(quest({ expiresAt: NOW - 1, status: "enrolled" }), NOW)).toBe("expired");
  });

  it("keeps a finished quest finished even after its deadline", () => {
    expect(questState(quest({ expiresAt: NOW - DAY, status: "completed" }), NOW)).toBe("completed");
  });

  it("never expires a quest without a deadline", () => {
    expect(questState(quest({ expiresAt: null }), NOW)).toBe("available");
  });

  it("tells which states are still worth acting on", () => {
    expect([isOpen("available"), isOpen("inProgress"), isOpen("completed"), isOpen("expired")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("tasks", () => {
  it("finds the play-on-desktop objective only", () => {
    const watching = quest({ tasks: [{ kind: "watchVideo", targetSeconds: 30 }] });
    expect(playTask(watching)).toBeUndefined();
    expect(playTask(quest())?.targetSeconds).toBe(900);
  });

  it("rounds minutes up and never goes below one", () => {
    expect(taskMinutes({ kind: "playOnDesktop", targetSeconds: 900 })).toBe(15);
    expect(taskMinutes({ kind: "playOnDesktop", targetSeconds: 901 })).toBe(16);
    expect(taskMinutes({ kind: "playOnDesktop", targetSeconds: 10 })).toBe(1);
  });
});

describe("resolveQuestGame", () => {
  const games = [game("1", "Overwatch"), game("2", "Fortnite")];

  it("prefers the application id", () => {
    const resolved = resolveQuestGame(quest({ applicationId: "2", gameTitle: "Overwatch" }), games);
    expect(resolved).toEqual({ game: games[1], match: "id" });
  });

  it("falls back to the game title when the id is unknown", () => {
    const resolved = resolveQuestGame(quest({ applicationId: "999", gameTitle: "Overwatch" }), games);
    expect(resolved?.match).toBe("name");
    expect(resolved?.game.id).toBe("1");
  });

  it("uses the quest name when there is no game title", () => {
    expect(resolveQuestGame(quest({ name: "Fortnite" }), games)?.game.id).toBe("2");
  });

  it("refuses a near miss: another edition of a game is not the game", () => {
    const sports = [game("1", "EA Sports FC 26")];
    const resolved = resolveQuestGame(quest({ gameTitle: "EA SPORTS FC™ 27" }), sports);
    expect(resolved).toBeNull();
  });

  it("accepts the same title written differently", () => {
    const sports = [game("1", "EA Sports FC™ 26")];
    const resolved = resolveQuestGame(quest({ gameTitle: "EA SPORTS FC 26" }), sports);
    expect(resolved?.game.id).toBe("1");
  });

  it("finds nothing for an unknown game", () => {
    expect(resolveQuestGame(quest({ name: "Zzzzzz Qqqqqq" }), games)).toBeNull();
  });

  it("matches an alias of the game", () => {
    const aliased = [{ ...game("1", "Overwatch"), aliases: ["OW2"] }];
    expect(resolveQuestGame(quest({ gameTitle: "ow2" }), aliased)?.game.id).toBe("1");
  });

  it("finds games in a very large catalog without searching it", () => {
    const many = Array.from({ length: 20_000 }, (_, index) => game(String(index + 10), `Game number ${index.toString()}`));
    const started = performance.now();
    for (let index = 0; index < 200; index += 1) resolveQuestGame(quest({ applicationId: "x", name: "Nothing like it" }), many);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("sortQuests", () => {
  it("lists open quests by deadline, then finished ones", () => {
    const sorted = sortQuests(
      [
        quest({ id: "done", status: "completed", expiresAt: NOW + 10 * DAY }),
        quest({ id: "late", expiresAt: NOW + 9 * DAY }),
        quest({ id: "soon", expiresAt: NOW + DAY }),
        quest({ id: "gone", expiresAt: NOW - DAY }),
      ],
      NOW,
    );
    expect(sorted.map((item) => item.id)).toEqual(["soon", "late", "done", "gone"]);
  });

  it("puts quests without a deadline after dated ones", () => {
    const sorted = sortQuests([quest({ id: "open", expiresAt: null }), quest({ id: "dated" })], NOW);
    expect(sorted.map((item) => item.id)).toEqual(["dated", "open"]);
  });
});

describe("remainingSeconds", () => {
  it("is what Discord still wants from the play objective", () => {
    expect(remainingSeconds(quest({ progressSeconds: 300 }))).toBe(600);
  });

  it("never goes below zero", () => {
    expect(remainingSeconds(quest({ progressSeconds: 1200 }))).toBe(0);
  });

  it("is unknown without progress or without a play objective", () => {
    expect(remainingSeconds(quest())).toBeNull();
    const watching = quest({ tasks: [{ kind: "watchVideo", targetSeconds: 30 }], progressSeconds: 10 });
    expect(remainingSeconds(watching)).toBeNull();
  });
});

describe("settledAt", () => {
  it("prefers the claim, then the completion, then the deadline", () => {
    expect(settledAt(quest({ claimedAt: 3, completedAt: 2, expiresAt: 1 }))).toBe(3);
    expect(settledAt(quest({ completedAt: 2, expiresAt: 1 }))).toBe(2);
    expect(settledAt(quest({ expiresAt: 1 }))).toBe(1);
  });

  it("orders finished quests by when they were settled", () => {
    const sorted = sortQuests(
      [
        quest({ id: "old", status: "claimed", claimedAt: NOW - 9 * DAY, expiresAt: NOW + 30 * DAY }),
        quest({ id: "recent", status: "completed", completedAt: NOW - DAY, expiresAt: NOW - 20 * DAY }),
      ],
      NOW,
    );
    expect(sorted.map((item) => item.id)).toEqual(["recent", "old"]);
  });
});

describe("sameTitle", () => {
  it("ignores case, accents, trademark symbols and punctuation", () => {
    expect(sameTitle("Pokémon: Legends", "POKEMON LEGENDS")).toBe(true);
    expect(sameTitle("Game™", "game")).toBe(true);
  });

  it("tells different titles apart", () => {
    expect(sameTitle("FC 26", "FC 27")).toBe(false);
    expect(sameTitle("Overwatch", "Overwatch 2")).toBe(false);
  });
});

describe("resolveQuestGames", () => {
  const games = [game("1", "Resident Evil"), game("2", "Resident Evil 4"), game("3", "Fortnite")];

  it("offers every accepted game that is in the catalog, and never guesses by title", () => {
    const resolved = resolveQuestGames(
      quest({ name: "Resident Evil Sale", gameTitle: "Resident Evil", eligibleApplicationIds: ["2", "404", "3"] }),
      games,
    );
    expect(resolved.map((entry) => entry.game.id)).toEqual(["2", "3"]);
    expect(resolved.every((entry) => entry.match === "id")).toBe(true);
  });

  it("offers nothing when none of the accepted games is known", () => {
    expect(resolveQuestGames(quest({ gameTitle: "Resident Evil", eligibleApplicationIds: ["404"] }), games)).toEqual([]);
  });

  it("falls back to the single best guess without a game list", () => {
    expect(resolveQuestGames(quest({ gameTitle: "Fortnite" }), games)).toEqual([{ game: games[2], match: "name" }]);
    expect(resolveQuestGames(quest({ gameTitle: "Nope" }), games)).toEqual([]);
  });
});

describe("sorting, filtering and totals of open quests", () => {
  const video = (overrides: Partial<Quest> = {}) =>
    quest({ tasks: [{ kind: "watchVideo", targetSeconds: 120 }], ...overrides });

  it("sorts by deadline, reward or time left", () => {
    const a = quest({ id: "a", expiresAt: NOW + 3 * DAY, rewardOrbs: 200, tasks: [{ kind: "playOnDesktop", targetSeconds: 900 }] });
    const b = quest({ id: "b", expiresAt: NOW + DAY, rewardOrbs: null, tasks: [{ kind: "playOnDesktop", targetSeconds: 900 }], progressSeconds: 100 });
    const c = quest({ id: "c", expiresAt: NOW + 2 * DAY, rewardOrbs: 700, tasks: [{ kind: "playOnDesktop", targetSeconds: 300 }] });

    const ids = (sort: Parameters<typeof sortOpenQuests>[1]) => sortOpenQuests([a, b, c], sort).map((q) => q.id);
    expect(ids("expiry")).toEqual(["b", "c", "a"]);
    expect(ids("reward")).toEqual(["c", "a", "b"]);
    expect(ids("remaining")).toEqual(["c", "b", "a"]);
  });

  it("keeps only play or video quests when asked", () => {
    const play = quest({ id: "p" });
    const clip = video({ id: "v" });
    expect(filterByKind([play, clip], "all")).toHaveLength(2);
    expect(filterByKind([play, clip], "video").map((q) => q.id)).toEqual(["v"]);
    expect(filterByKind([play, clip], "play").map((q) => q.id)).toEqual(["p"]);
  });

  it("adds up the Orbs at stake, ignoring other rewards", () => {
    expect(orbsAtStake([quest({ rewardOrbs: 700 }), quest({ rewardOrbs: 200 }), quest({ rewardOrbs: null })])).toBe(900);
  });

  it("flags open quests that expire within a day only", () => {
    const soon = quest({ id: "soon", expiresAt: NOW + DAY / 2 });
    const later = quest({ id: "later", expiresAt: NOW + 3 * DAY });
    const gone = quest({ id: "gone", expiresAt: NOW - 1 });
    const done = quest({ id: "done", expiresAt: NOW + DAY / 2, status: "completed" });
    expect(expiringSoon([soon, later, gone, done], NOW).map((q) => q.id)).toEqual(["soon"]);
  });
});
