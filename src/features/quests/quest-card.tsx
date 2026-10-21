import { memo, useState } from "react";

import { Clapperboard } from "lucide-react";
import { PlayIcon, PlusIcon, SearchIcon, TriangleAlertIcon, TrophyIcon } from "@/components/icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/ui/game-icon";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/primitives";
import { useAddToLibrary } from "@/features/games/queries";
import { useQuestAction, useQuestRisk, useVideoProgress, type QuestAction } from "@/features/quests/queries";
import { useStartSession } from "@/features/sessions/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import { firstPlayable } from "@/lib/executables";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import {
  isOpen,
  isVideoQuest,
  playTask,
  questState,
  remainingSeconds,
  taskMinutes,
  type QuestGame,
  type QuestState,
} from "@/lib/quests";
import type { Quest } from "@/types/domain";

const STATE_TONE: Record<QuestState, "neutral" | "accent" | "success" | "warning"> = {
  available: "neutral",
  inProgress: "accent",
  completed: "success",
  claimed: "success",
  expired: "warning",
};

interface QuestCardProps {
  quest: Quest;
  now: number;
  /** The catalog games that complete the quest: none when it could not be identified. */
  resolved: QuestGame[];
  libraryIds: ReadonlySet<string>;
  runningIds: ReadonlySet<string>;
}

interface PlayActionsProps {
  quest: Quest;
  resolved: QuestGame | null;
  inLibrary: boolean;
  running: boolean;
}

/** Which of the games a quest accepts to start: the one already running, then one in the library, then a playable one. */
function bestGame(games: QuestGame[], libraryIds: ReadonlySet<string>, runningIds: ReadonlySet<string>): QuestGame | null {
  const rank = ({ game }: QuestGame) =>
    runningIds.has(game.id) ? 0 : firstPlayable(game) ? (libraryIds.has(game.id) ? 1 : 2) : 3;
  return games.reduce<QuestGame | null>((best, game) => (best === null || rank(game) < rank(best) ? game : best), null);
}

/** Chooses among the games a quest accepts. */
function GamePicker({
  games,
  selectedId,
  onSelect,
}: {
  games: QuestGame[];
  selectedId: string;
  onSelect: (gameId: string) => void;
}) {
  const { t } = useT();

  return (
    <div className="mt-3">
      <p className="text-xs text-subtle">{t("quests.pickGame", { count: games.length })}</p>
      <div role="radiogroup" aria-label={t("quests.pickGame", { count: games.length })} className="mt-1.5 flex flex-wrap gap-1.5">
        {games.map(({ game }) => (
          <button
            key={game.id}
            type="button"
            role="radio"
            aria-checked={game.id === selectedId}
            aria-label={game.name}
            title={game.name}
            onClick={() => {
              onSelect(game.id);
            }}
            className={cn(
              "rounded-[26%] p-0.5 outline-offset-2 transition-opacity",
              game.id === selectedId ? "ring-2 ring-accent-text" : "opacity-60 hover:opacity-100",
            )}
          >
            <GameIcon gameId={game.id} name={game.name} iconHash={game.iconHash} size={32} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** What to do about a quest that asks to play a game. */
function PlayActions({ quest, resolved, inLibrary, running }: PlayActionsProps) {
  const { t } = useT();
  const add = useAddToLibrary();
  const start = useStartSession();
  const openSearch = useUiStore((state) => state.openSearch);

  const task = playTask(quest);
  if (!task) return null;
  const minutes = taskMinutes(task);

  if (!resolved) {
    return (
      <Button
        size="sm"
        onClick={() => {
          openSearch(quest.gameTitle ?? quest.name);
        }}
      >
        <SearchIcon />
        {t("quests.search", { name: quest.gameTitle ?? quest.name })}
      </Button>
    );
  }

  const { game } = resolved;
  const executable = firstPlayable(game);
  if (!executable) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-warning">
        <TriangleAlertIcon size={16} className="shrink-0" />
        {t("quests.noWindows")}
      </p>
    );
  }

  if (running) return <Badge tone="success">{t("quests.running")}</Badge>;

  const launch = () => {
    start.mutate({ gameId: game.id, executable: executable.name, targetMinutes: minutes });
  };

  if (inLibrary) {
    return (
      <Button variant="primary" size="sm" disabled={start.isPending} onClick={launch}>
        <PlayIcon className="[&_svg]:fill-current" />
        {t("quests.launch", { minutes })}
      </Button>
    );
  }

  const addToLibrary = (thenLaunch: boolean) => {
    add.mutate(game.id, {
      onSuccess: () => {
        toast.success(t("games.addedToast", { name: game.name }));
        if (thenLaunch) launch();
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={add.isPending}
        onClick={() => {
          addToLibrary(false);
        }}
      >
        <PlusIcon />
        {t("quests.add")}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={add.isPending}
        onClick={() => {
          addToLibrary(true);
        }}
      >
        <PlayIcon className="[&_svg]:fill-current" />
        {t("quests.addAndLaunch")}
      </Button>
    </div>
  );
}

/** The writes on the account: accept, complete the video, claim the reward. Each one is a click on this quest, confirmed first. */
function AccountActions({ quest, state }: { quest: Quest; state: QuestState }) {
  const { t } = useT();
  const mutations = {
    enroll: useQuestAction("enroll"),
    watchVideo: useQuestAction("watchVideo"),
    claim: useQuestAction("claim"),
  };
  const [confirming, setConfirming] = useState<QuestAction | null>(null);
  const { data: risk } = useQuestRisk();
  const live = useVideoProgress(quest.id);
  const watching = live !== null || mutations.watchVideo.isPending;

  const action: QuestAction | null =
    state === "available"
      ? "enroll"
      : state === "inProgress" && isVideoQuest(quest)
        ? "watchVideo"
        : state === "completed" && quest.reward
          ? "claim"
          : null;
  if (action === null) return null;

  const mutation = mutations[action];
  const label = t(WRITE_LABELS[action].button);

  const run = () => {
    setConfirming(null);
    mutation.mutate(quest.id, {
      // A viewing ends later: the end is announced by an event, not by this call.
      onSuccess: () => {
        if (action !== "watchVideo") toast.success(t(WRITE_LABELS[action].done));
      },
    });
  };

  return (
    <>
      <Button
        variant={action === "enroll" ? "secondary" : "primary"}
        size="sm"
        disabled={mutation.isPending || (action === "watchVideo" && watching)}
        onClick={() => {
          setConfirming(action);
        }}
      >
        {action === "watchVideo" ? <Clapperboard aria-hidden="true" /> : null}
        {action === "claim" ? <TrophyIcon /> : null}
        {action === "watchVideo" && watching
          ? live && live.target > 0
            ? t("quests.watchingVideoProgress", { done: formatDuration(live.seconds), total: formatDuration(live.target) })
            : t("quests.watchingVideo")
          : label}
      </Button>
      {live ? (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={live.target}
          aria-valuenow={live.seconds}
          className="h-1.5 basis-full overflow-hidden rounded-full bg-sunken"
        >
          <div
            className="h-full rounded-full bg-accent-text transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ width: `${((live.seconds / Math.max(1, live.target)) * 100).toString()}%` }}
          />
        </div>
      ) : null}
      <Modal
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title={t("quests.write.title", { action: label, quest: quest.name })}
        description={t("quests.write.body")}
      >
        <div className="mx-6 mt-3 rounded-lg bg-danger-soft p-3 text-[13px] text-danger">
          <p className="font-semibold">{t("quests.risk.ban")}</p>
          <p className="mt-1">{t("quests.write.risk")}</p>
          {risk && risk.level !== "low" ? (
            <p className="mt-2 font-medium">{t(`quests.risk.warn.${risk.level}`)}</p>
          ) : null}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2 px-6 pb-6">
          <Button
            variant="ghost"
            onClick={() => {
              setConfirming(null);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={run}>
            {t("quests.write.confirm", { action: label })}
          </Button>
        </div>
      </Modal>
    </>
  );
}

const WRITE_LABELS = {
  enroll: { button: "quests.accept", done: "quests.accepted" },
  watchVideo: { button: "quests.watchVideo", done: "quests.videoDone" },
  claim: { button: "quests.claim", done: "quests.claimed" },
} as const satisfies Record<QuestAction, { button: MessageKey; done: MessageKey }>;

/**
 * What Discord says while a fake game runs for the quest. The progress only
 * moves about once a minute, so the figure is an estimate, not a countdown.
 */
function LiveStatus({ remaining }: { remaining: number | null }) {
  const { t } = useT();

  const message =
    remaining === null
      ? t("quests.live.waiting")
      : remaining === 0
        ? t("quests.live.validating")
        : t("quests.live.remaining", { time: formatDuration(remaining) });

  return (
    <p className="mt-2 text-[13px] tabular-nums text-accent-text" aria-live="polite">
      {message}
    </p>
  );
}

/** Memoized: the list re-renders on every update of the quests, but most cards did not change. */
export const QuestCard = memo(function QuestCard({ quest, now, resolved: games, libraryIds, runningIds }: QuestCardProps) {
  const { t, locale } = useT();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const resolved = games.find(({ game }) => game.id === pickedId) ?? bestGame(games, libraryIds, runningIds);
  const inLibrary = resolved !== null && libraryIds.has(resolved.game.id);
  const running = games.some(({ game }) => runningIds.has(game.id));
  const state = questState(quest, now);
  const open = isOpen(state);
  const task = playTask(quest);
  // Only a date Discord gave: the deadline says nothing about when it was done.
  const settled = state === "claimed" ? quest.claimedAt : state === "completed" ? quest.completedAt : null;

  const progress =
    task && quest.progressSeconds !== null && task.targetSeconds > 0
      ? Math.min(1, quest.progressSeconds / task.targetSeconds)
      : null;

  return (
    <li className={cn("rounded-card bg-surface p-5 shadow-card", !open && "opacity-75")}>
      <div className="flex gap-4">
        {games.length === 1 && resolved ? (
          <GameIcon gameId={resolved.game.id} name={resolved.game.name} iconHash={resolved.game.iconHash} size={52} />
        ) : (
          <div className="grid size-[52px] shrink-0 place-items-center rounded-[22%] bg-accent-soft text-accent-text">
            <TrophyIcon size={24} />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight">{quest.name}</h3>
              <p className="truncate text-[13px] text-muted">
                {[quest.gameTitle, quest.publisher].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Badge tone={STATE_TONE[state]}>{t(`quests.status.${state}` satisfies MessageKey)}</Badge>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
            {quest.tasks.map((item) => (
              <Badge key={item.kind} tone={item.kind === "playOnDesktop" || isVideoQuest(quest) ? "accent" : "neutral"}>
                {isVideoQuest(quest) ? <Clapperboard aria-hidden="true" /> : null}
                {t(`quests.task.${item.kind}` satisfies MessageKey)} · {formatDuration(item.targetSeconds)}
              </Badge>
            ))}
            {quest.anyTask && quest.tasks.length > 1 ? <span className="text-subtle">{t("quests.anyTask")}</span> : null}
            {quest.reward ? <span>{t("quests.reward", { reward: quest.reward })}</span> : null}
            {quest.expiresAt !== null ? (
              <span className={cn(state === "expired" && "text-warning")}>
                {state === "expired"
                  ? t("quests.expired")
                  : t("quests.expires", { when: formatRelativeTime(quest.expiresAt, now, locale) })}
              </span>
            ) : null}
          </div>

          {progress !== null && task && quest.progressSeconds !== null ? (
            <div className="mt-3 flex items-center gap-3">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
              >
                <div
                  className="h-full rounded-full bg-accent-text transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${(progress * 100).toString()}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted">
                {formatDuration(quest.progressSeconds)} / {formatDuration(task.targetSeconds)}
              </span>
            </div>
          ) : null}

          {running && open ? <LiveStatus remaining={remainingSeconds(quest)} /> : null}

          {settled !== null ? (
            <p className="mt-2 text-[13px] text-muted">
              {t(state === "claimed" ? "quests.claimedOn" : "quests.completedOn", {
                when: formatRelativeTime(settled, now, locale),
              })}
              {state === "completed" && quest.reward ? (
                <span className="text-warning"> · {t("quests.toClaim")}</span>
              ) : null}
            </p>
          ) : null}

          {open || (state === "completed" && quest.reward) ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <AccountActions quest={quest} state={state} />
            </div>
          ) : null}

          {open ? (
            <div className="mt-4">
              {task ? (
                <>
                  {games.length > 1 && resolved ? (
                    <GamePicker games={games} selectedId={resolved.game.id} onSelect={setPickedId} />
                  ) : null}
                  <div className={cn(games.length > 1 && "mt-3")}>
                    <PlayActions
                      quest={quest}
                      resolved={resolved}
                      inLibrary={inLibrary}
                      running={resolved !== null && runningIds.has(resolved.game.id)}
                    />
                  </div>
                  {resolved?.match === "name" ? (
                    <p className="mt-2 text-xs text-subtle">
                      {t("quests.probable", { name: resolved.game.name })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[13px] text-muted">
                  {t(isVideoQuest(quest) ? "quests.watchInDiscord" : "quests.notPlayable")}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
});
