import { describe, expect, it } from "vitest";

import type { Game, Quest, QueueStatus } from "@/types/domain";

import { estimatedMinutes, MAX_PLAYING, planQueue, queueItemFor, queuedQuestIds } from "./queue";
import type { QuestGame } from "./quests";

const NOW = 1_800_000_000_000;

function game(id: string, support: "ok" | "otherPlatform" = "ok"): Game {
  return {
    id,
    name: `Game ${id}`,
    aliases: [],
    executables: [{ name: "game.exe", os: "win32", isLauncher: false, support }],
    iconHash: null,
    themes: [],
  };
}

function quest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: "1",
    name: "Quest",
    gameTitle: null,
    publisher: null,
    applicationId: "10",
    eligibleApplicationIds: [],
    anyTask: false,
    reward: null,
    rewardOrbs: null,
    startsAt: null,
    expiresAt: NOW + 86_400_000,
    tasks: [{ kind: "playOnDesktop", targetSeconds: 900 }],
    status: "enrolled",
    progressSeconds: null,
    completedAt: null,
    claimedAt: null,
    ...overrides,
  };
}

const byId = (id: string): QuestGame => ({ game: game(id), match: "id" });

describe("queueItemFor", () => {
  it("plays an accepted PC quest for the time it asks", () => {
    expect(queueItemFor(quest(), [byId("10")], NOW)).toEqual({
      questId: "1",
      questName: "Quest",
      gameId: "10",
      gameName: "Game 10",
      executable: "game.exe",
      minutes: 15,
    });
  });

  it("only plays what Discord still wants", () => {
    expect(queueItemFor(quest({ progressSeconds: 600 }), [byId("10")], NOW)?.minutes).toBe(5);
    expect(queueItemFor(quest({ progressSeconds: 900 }), [byId("10")], NOW)).toBeNull();
  });

  it("skips quests that are not accepted, finished, expired or not played on a PC", () => {
    expect(queueItemFor(quest({ status: "available" }), [byId("10")], NOW)).toBeNull();
    expect(queueItemFor(quest({ status: "completed" }), [byId("10")], NOW)).toBeNull();
    expect(queueItemFor(quest({ expiresAt: NOW - 1 }), [byId("10")], NOW)).toBeNull();
    expect(queueItemFor(quest({ tasks: [{ kind: "watchVideo", targetSeconds: 30 }] }), [byId("10")], NOW)).toBeNull();
  });

  it("needs a game that can run here, preferring the one the quest names", () => {
    expect(queueItemFor(quest(), [], NOW)).toBeNull();
    expect(queueItemFor(quest(), [{ game: game("10", "otherPlatform"), match: "id" }], NOW)).toBeNull();
    const item = queueItemFor(quest(), [{ game: game("20"), match: "name" }, byId("10")], NOW);
    expect(item?.gameId).toBe("10");
  });
});

describe("planQueue", () => {
  it("puts the quest expiring first at the front and leaves out what cannot be played", () => {
    const later = quest({ id: "a", expiresAt: NOW + 3 * 86_400_000 });
    const sooner = quest({ id: "b", expiresAt: NOW + 3_600_000 });
    const endless = quest({ id: "c", expiresAt: null });
    const unknown = quest({ id: "d" });
    const resolved = new Map([
      ["a", [byId("10")]],
      ["b", [byId("11")]],
      ["c", [byId("12")]],
    ]);

    expect(planQueue([later, endless, unknown, sooner], resolved, NOW).map((item) => item.questId)).toEqual(["b", "a", "c"]);
  });
});

describe("queue status helpers", () => {
  const item = (questId: string) => ({ questId, questName: questId, gameId: "1", gameName: "G", executable: "g.exe", minutes: 15 });
  const status: QueueStatus = {
    playing: [{ item: item("b"), sessionId: "s", startedAt: 0 }],
    pending: [item("c")],
    done: [{ item: item("a"), outcome: "completed", message: null, at: 0 }],
  };

  it("knows which quests are queued", () => {
    expect([...queuedQuestIds(status)].sort()).toEqual(["b", "c"]);
  });

  it("estimates the longest quest, not the sum, since the games run together", () => {
    expect(estimatedMinutes([])).toBe(0);
    expect(estimatedMinutes([{ minutes: 15 }, { minutes: 15 }])).toBe(16);
    expect(estimatedMinutes([{ minutes: 15 }, { minutes: 30 }, { minutes: 5 }])).toBe(31);
    // Beyond the slots, the next batch waits for the first one.
    const many = Array.from({ length: MAX_PLAYING + 1 }, () => ({ minutes: 10 }));
    expect(estimatedMinutes(many)).toBe(21);
  });
});
