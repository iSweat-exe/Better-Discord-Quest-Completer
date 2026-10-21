import type { Quest } from "@/types/domain";

import { isOpen, questState } from "./quests";

/** Totals over the quests Discord lists for the account. */
export interface QuestStats {
  /** Finished: the objective is met, whether or not the reward was claimed. */
  completed: number;
  /** Finished, but the reward still waits to be claimed in Discord. */
  toClaim: number;
  /** Not finished in time. */
  expired: number;
  inProgress: number;
  /** Not accepted yet. */
  available: number;
  /** Orbs of the rewards already claimed. */
  orbsClaimed: number;
  /** Orbs of the rewards that wait to be claimed. */
  orbsToClaim: number;
}

export function questStats(quests: readonly Quest[], now: number): QuestStats {
  const stats: QuestStats = {
    completed: 0,
    toClaim: 0,
    expired: 0,
    inProgress: 0,
    available: 0,
    orbsClaimed: 0,
    orbsToClaim: 0,
  };

  for (const quest of quests) {
    const state = questState(quest, now);
    const orbs = quest.rewardOrbs ?? 0;

    if (state === "claimed") {
      stats.completed += 1;
      stats.orbsClaimed += orbs;
    } else if (state === "completed") {
      stats.completed += 1;
      stats.toClaim += 1;
      stats.orbsToClaim += orbs;
    } else if (state === "expired") {
      stats.expired += 1;
    } else if (isOpen(state)) {
      stats[state === "inProgress" ? "inProgress" : "available"] += 1;
    }
  }
  return stats;
}
