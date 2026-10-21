import { describe, expect, it } from "vitest";

import type { Quest } from "@/types/domain";

import { questStats } from "./stats";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

const quest = (overrides: Partial<Quest>): Quest => ({
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
  tasks: [],
  status: "available",
  progressSeconds: null,
  completedAt: null,
  claimedAt: null,
  ...overrides,
});

describe("questStats", () => {
  it("is all zeros without quests", () => {
    expect(questStats([], NOW)).toEqual({
      completed: 0,
      toClaim: 0,
      expired: 0,
      inProgress: 0,
      available: 0,
      orbsClaimed: 0,
      orbsToClaim: 0,
    });
  });

  it("counts every quest in exactly one bucket", () => {
    const stats = questStats(
      [
        quest({ status: "available" }),
        quest({ status: "enrolled" }),
        quest({ status: "enrolled" }),
        quest({ status: "completed" }),
        quest({ status: "claimed" }),
        quest({ status: "available", expiresAt: NOW - DAY }),
      ],
      NOW,
    );

    expect(stats).toMatchObject({ available: 1, inProgress: 2, completed: 2, toClaim: 1, expired: 1 });
  });

  it("counts a finished quest as finished even past its deadline", () => {
    expect(questStats([quest({ status: "claimed", expiresAt: NOW - DAY })], NOW)).toMatchObject({
      completed: 1,
      expired: 0,
    });
  });

  it("separates the Orbs already claimed from the ones still to claim", () => {
    const stats = questStats(
      [
        quest({ status: "claimed", rewardOrbs: 700 }),
        quest({ status: "claimed", rewardOrbs: 200 }),
        quest({ status: "completed", rewardOrbs: 450 }),
        quest({ status: "enrolled", rewardOrbs: 999 }),
        quest({ status: "claimed", rewardOrbs: null }),
      ],
      NOW,
    );

    expect(stats.orbsClaimed).toBe(900);
    expect(stats.orbsToClaim).toBe(450);
  });
});
