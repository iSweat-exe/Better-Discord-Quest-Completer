import { memo } from "react";

import { PlayIcon, PlusIcon, SearchIcon, TriangleAlertIcon, TrophyIcon } from "@/components/icons";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/ui/game-icon";
import { Badge } from "@/components/ui/primitives";
import { useAddToLibrary } from "@/features/games/queries";
import { useStartSession } from "@/features/sessions/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import { firstPlayable } from "@/lib/executables";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import {
  isOpen,
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
  /** The catalog game the quest asks to play, when it could be identified. */
  resolved: QuestGame | null;
  inLibrary: boolean;
  running: boolean;
}

/** What to do about a quest that asks to play a game. */
function PlayActions({ quest, resolved, inLibrary, running }: Omit<QuestCardProps, "now">) {
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
export const QuestCard = memo(function QuestCard({ quest, now, resolved, inLibrary, running }: QuestCardProps) {
  const { t, locale } = useT();
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
        {resolved ? (
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
              <Badge key={item.kind} tone={item.kind === "playOnDesktop" ? "accent" : "neutral"}>
                {t(`quests.task.${item.kind}` satisfies MessageKey)} · {formatDuration(item.targetSeconds)}
              </Badge>
            ))}
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

          {open ? (
            <div className="mt-4">
              {task ? (
                <>
                  <PlayActions quest={quest} resolved={resolved} inLibrary={inLibrary} running={running} />
                  {resolved?.match === "name" ? (
                    <p className="mt-2 text-xs text-subtle">
                      {t("quests.probable", { name: resolved.game.name })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-[13px] text-muted">{t("quests.notPlayable")}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
});
