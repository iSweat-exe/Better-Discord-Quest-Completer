import { memo, useState } from "react";

import { Clapperboard } from "lucide-react";

import { TrophyIcon } from "@/components/icons";
import { GameIcon } from "@/components/ui/game-icon";
import { Badge } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/progress-bar";
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
  type QuestGame,
  type QuestState,
} from "@/lib/quests";
import type { Quest } from "@/types/domain";

import { AccountActions } from "./account-actions";
import { GamePicker, PlayActions } from "./play-actions";

const STATE_TONE: Record<QuestState, "neutral" | "accent" | "success" | "warning"> = {
  available: "neutral",
  inProgress: "accent",
  completed: "success",
  claimed: "success",
  expired: "warning",
};

/** Which of the games a quest accepts to start: the one already running, then one in the library, then a playable one. */
function bestGame(games: QuestGame[], libraryIds: ReadonlySet<string>, runningIds: ReadonlySet<string>): QuestGame | null {
  const rank = ({ game }: QuestGame) =>
    runningIds.has(game.id) ? 0 : firstPlayable(game) ? (libraryIds.has(game.id) ? 1 : 2) : 3;
  return games.reduce<QuestGame | null>((best, game) => (best === null || rank(game) < rank(best) ? game : best), null);
}

interface QuestCardProps {
  quest: Quest;
  now: number;
  /** The catalog games that complete the quest: none when it could not be identified. */
  resolved: QuestGame[];
  libraryIds: ReadonlySet<string>;
  runningIds: ReadonlySet<string>;
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
              <ProgressBar value={progress} className="flex-1" />
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
              ) : isVideoQuest(quest) ? null : (
                <p className="text-[13px] text-muted">{t("quests.notPlayable")}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
});
