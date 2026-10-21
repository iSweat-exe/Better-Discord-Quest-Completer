import type { Game, Quest, QuestTask } from "@/types/domain";

export type QuestState = "available" | "inProgress" | "completed" | "claimed" | "expired";

/** Where a quest stands, taking its deadline into account. */
export function questState(quest: Quest, now: number): QuestState {
  if (quest.status === "claimed") return "claimed";
  if (quest.status === "completed") return "completed";
  if (quest.expiresAt !== null && quest.expiresAt < now) return "expired";
  return quest.status === "enrolled" ? "inProgress" : "available";
}

/** A quest still worth acting on. */
export function isOpen(state: QuestState): boolean {
  return state === "available" || state === "inProgress";
}

/** The "play on desktop" objective: the only one a fake game can complete. */
export function playTask(quest: Quest): QuestTask | undefined {
  return quest.tasks.find((task) => task.kind === "playOnDesktop");
}

/** A quest asked in a video (an ad to watch): Discord shows it in its own client, no fake game can do it. */
export function isVideoQuest(quest: Quest): boolean {
  return quest.tasks.some((task) => task.kind === "watchVideo" || task.kind === "watchVideoOnMobile");
}

/** Minutes to play, rounded up: Discord counts whole minutes of playtime. */
export function taskMinutes(task: QuestTask): number {
  return Math.max(1, Math.ceil(task.targetSeconds / 60));
}

export interface QuestGame {
  game: Game;
  /** `id`: the quest names the game's application. `name`: a probable match by title. */
  match: "id" | "name";
}

/** The catalog indexed for the two questions a quest asks: which game has this id, and this title. */
interface GameLookup {
  byId: Map<string, Game>;
  byTitle: Map<string, Game>;
}

const lookups = new WeakMap<Game[], GameLookup>();

function lookupFor(games: Game[]): GameLookup {
  let lookup = lookups.get(games);
  if (!lookup) {
    const byId = new Map<string, Game>();
    const byTitle = new Map<string, Game>();
    for (const game of games) {
      byId.set(game.id, game);
      // The first game with a title keeps it: a name wins over another game's alias.
      for (const title of [game.name, ...game.aliases]) {
        const key = simplifyTitle(title);
        if (key !== "" && !byTitle.has(key)) byTitle.set(key, game);
      }
    }
    lookup = { byId, byTitle };
    lookups.set(games, lookup);
  }
  return lookup;
}

/**
 * Builds the lookup of a catalog now. On ten thousand games it takes a moment,
 * so it is meant to run while the app is idle, not when the quests page opens.
 */
export function warmUpQuestLookup(games: Game[]): void {
  lookupFor(games);
}

/**
 * Every catalog game that completes a quest. When Discord lists the games a quest
 * accepts, only those count: the quest's name (« Resident Evil Sale ») may match
 * one title of the franchise and still not be what to play. Without such a list,
 * the single best guess of [resolveQuestGame] is used.
 */
export function resolveQuestGames(quest: Quest, games: Game[]): QuestGame[] {
  if (quest.eligibleApplicationIds.length === 0) {
    const single = resolveQuestGame(quest, games);
    return single ? [single] : [];
  }

  const { byId } = lookupFor(games);
  return quest.eligibleApplicationIds.flatMap((id) => {
    const game = byId.get(id);
    return game ? [{ game, match: "id" as const }] : [];
  });
}

/** Finds the catalog game a quest asks to play. */
export function resolveQuestGame(quest: Quest, games: Game[]): QuestGame | null {
  const { byId, byTitle } = lookupFor(games);

  if (quest.applicationId) {
    const exact = byId.get(quest.applicationId);
    if (exact) return { game: exact, match: "id" };
  }

  // A near miss is worse than no answer: « FC 26 » is not « FC 27 », and adding
  // the wrong game would not complete the quest. Only identical titles count.
  const same = byTitle.get(simplifyTitle(quest.gameTitle ?? quest.name));
  return same ? { game: same, match: "name" } : null;
}

/** Ignores case, accents, ™/®/© and punctuation. */
function simplifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[©®™]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Compares titles ignoring case, accents, ™/®/© and punctuation. */
export function sameTitle(a: string, b: string): boolean {
  return simplifyTitle(a) === simplifyTitle(b);
}

/** What Discord still wants from the "play" objective, or `null` while it reports no progress. */
export function remainingSeconds(quest: Quest): number | null {
  const task = playTask(quest);
  if (!task || quest.progressSeconds === null) return null;
  return Math.max(0, task.targetSeconds - quest.progressSeconds);
}

/** When a finished quest was settled: claimed, else completed, else its deadline. */
export function settledAt(quest: Quest): number | null {
  return quest.claimedAt ?? quest.completedAt ?? quest.expiresAt;
}

/** Open quests first (soonest deadline first), then finished ones (most recent first). */
export function sortQuests(quests: Quest[], now: number): Quest[] {
  const rank = (quest: Quest) => (isOpen(questState(quest, now)) ? 0 : 1);

  return quests.toSorted((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 0) {
      return (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER);
    }
    return (settledAt(b) ?? 0) - (settledAt(a) ?? 0);
  });
}

/** The objective of a quest the app can do: playing, else watching, else the first one. */
export function objectiveTask(quest: Quest): QuestTask | undefined {
  return (
    playTask(quest) ??
    quest.tasks.find((task) => task.kind === "watchVideo" || task.kind === "watchVideoOnMobile") ??
    quest.tasks[0]
  );
}

/** What is still to do on the objective, in seconds (all of it while Discord reports no progress). */
export function remainingObjectiveSeconds(quest: Quest): number {
  const task = objectiveTask(quest);
  if (!task) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, task.targetSeconds - (quest.progressSeconds ?? 0));
}

export type QuestSort = "expiry" | "reward" | "remaining";
export type QuestKind = "all" | "play" | "video";

/** Open quests in the order asked: soonest deadline, biggest Orbs reward, or least time left. */
export function sortOpenQuests(quests: Quest[], sort: QuestSort): Quest[] {
  const far = Number.MAX_SAFE_INTEGER;
  const byExpiry = (a: Quest, b: Quest) => (a.expiresAt ?? far) - (b.expiresAt ?? far);

  return quests.toSorted((a, b) => {
    if (sort === "reward") return (b.rewardOrbs ?? -1) - (a.rewardOrbs ?? -1) || byExpiry(a, b);
    if (sort === "remaining") return remainingObjectiveSeconds(a) - remainingObjectiveSeconds(b) || byExpiry(a, b);
    return byExpiry(a, b);
  });
}

export function filterByKind(quests: Quest[], kind: QuestKind): Quest[] {
  if (kind === "all") return quests;
  return quests.filter((quest) => isVideoQuest(quest) === (kind === "video"));
}

/** Orbs the given quests would grant if they were all done. */
export function orbsAtStake(quests: readonly Quest[]): number {
  return quests.reduce((total, quest) => total + (quest.rewardOrbs ?? 0), 0);
}

const DAY_MS = 86_400_000;

/** Open quests whose deadline is less than a day away. */
export function expiringSoon(quests: readonly Quest[], now: number): Quest[] {
  return quests.filter(
    (quest) =>
      isOpen(questState(quest, now)) && quest.expiresAt !== null && quest.expiresAt > now && quest.expiresAt - now <= DAY_MS,
  );
}
