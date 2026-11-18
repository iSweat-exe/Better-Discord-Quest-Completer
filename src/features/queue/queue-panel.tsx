import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PlayIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Badge, Spinner } from "@/components/ui/primitives";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useSessionStore } from "@/features/sessions/session-store";
import { formatClock, formatDuration } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { estimatedMinutes, isQueueActive, planQueue, queuedQuestIds } from "@/lib/queue";
import type { QuestGame } from "@/lib/quests";
import { timerElapsedSeconds } from "@/lib/sessions";
import { useNow } from "@/lib/use-now";
import type { Quest, QueueItem, QueueOutcome, QueueStatus } from "@/types/domain";

import { useEnqueueQuests, useRemoveFromQueue, useSkipQueueItem, useStopQueue } from "./queries";
import { useQueueStore } from "./queue-store";

const OUTCOME_TONES: Record<QueueOutcome, "success" | "neutral" | "danger" | "warning"> = {
  completed: "success",
  skipped: "neutral",
  failed: "danger",
  timedOut: "warning",
};

/** How far the game of a playing quest went: ticks every second, alone. */
function CurrentProgress({ sessionId, minutes }: { sessionId: string | null; minutes: number }) {
  const { t } = useT();
  const now = useNow();
  const session = useSessionStore((state) => state.sessions.find((candidate) => candidate.id === sessionId));

  if (!sessionId || !session) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Spinner /> {t("queue.starting")}
      </p>
    );
  }

  const elapsed = timerElapsedSeconds(session, now);
  if (elapsed === null) {
    return <p className="text-[13px] text-warning">{t("games.status.waiting")}</p>;
  }

  const target = minutes * 60;
  return (
    <div className="space-y-1.5">
      <ProgressBar value={elapsed / target} label={t("queue.progress")} />
      <p className="text-xs tabular-nums text-muted">
        {elapsed >= target ? t("quests.live.validating") : `${formatClock(elapsed)} / ${formatClock(target)}`}
      </p>
    </div>
  );
}

function ActiveQueue({ status, addable }: { status: QueueStatus; addable: QueueItem[] }) {
  const { t } = useT();
  const skip = useSkipQueueItem();
  const stop = useStopQueue();
  const remove = useRemoveFromQueue();
  const enqueue = useEnqueueQuests();

  return (
    <section className="rounded-card bg-surface p-5 shadow-card" aria-label={t("queue.title")}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("queue.title")}</h2>
          <p className="mt-0.5 text-xs text-muted">
            {t("queue.playing", { count: status.playing.length })}
            {status.pending.length > 0 ? ` · ${t("queue.waiting", { count: status.pending.length })}` : ""}
          </p>
        </div>
        <Button size="sm" variant="danger" disabled={stop.isPending} onClick={() => stop.mutate()}>
          {t("queue.stop")}
        </Button>
      </header>

      <ul className="mt-4 flex flex-col gap-2" aria-label={t("queue.playingList")}>
        {status.playing.map((playing) => (
          <li key={playing.item.questId} className="flex items-start gap-3 rounded-inner bg-sunken p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">
                {playing.item.gameName}
                <span className="font-normal text-muted"> · {playing.item.questName}</span>
              </p>
              <div className="mt-2">
                <CurrentProgress sessionId={playing.sessionId} minutes={playing.item.minutes} />
              </div>
            </div>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={t("queue.skip", { name: playing.item.questName })}
              disabled={skip.isPending}
              onClick={() => skip.mutate(playing.item.questId)}
            >
              <XIcon size={14} />
            </Button>
          </li>
        ))}
      </ul>

      {status.pending.length > 0 ? (
        <ol className="mt-3 flex flex-col gap-1" aria-label={t("queue.next")}>
          {status.pending.map((item, index) => (
            <li key={item.questId} className="flex items-center gap-3 rounded-inner px-2 py-1.5 text-[13px] hover:bg-raised">
              <span className="w-5 text-right tabular-nums text-subtle">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate">
                {item.gameName}
                <span className="text-muted"> · {item.questName}</span>
              </span>
              <span className="tabular-nums text-muted">{formatDuration(item.minutes * 60)}</span>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={t("queue.remove", { name: item.questName })}
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.questId)}
              >
                <XIcon size={14} />
              </Button>
            </li>
          ))}
        </ol>
      ) : null}

      {addable.length > 0 ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          disabled={enqueue.isPending}
          onClick={() => enqueue.mutate(addable)}
        >
          {t("queue.addOthers", { count: addable.length })}
        </Button>
      ) : null}
    </section>
  );
}

/** What the last run of the queue achieved, once it is over. */
function LastRun({ status }: { status: QueueStatus }) {
  const { t } = useT();
  const clear = useStopQueue();
  if (status.done.length === 0) return null;
  const completed = status.done.filter((done) => done.outcome === "completed").length;

  return (
    <details className="group rounded-card bg-surface px-5 py-3 text-[13px] shadow-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="font-medium">{t("queue.lastRun", { completed, total: status.done.length })}</span>
        <span className="text-xs text-subtle group-open:hidden">{t("queue.details")}</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {status.done.map((done) => (
          <li key={`${done.item.questId}-${done.at.toString()}`} className="flex items-center gap-2">
            <Badge tone={OUTCOME_TONES[done.outcome]}>{t(`queue.outcome.${done.outcome}`)}</Badge>
            <span className="min-w-0 flex-1 truncate">
              {done.item.gameName}
              <span className="text-muted"> · {done.item.questName}</span>
            </span>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" className="mt-2" disabled={clear.isPending} onClick={() => clear.mutate()}>
        {t("queue.clearHistory")}
      </Button>
    </details>
  );
}

/**
 * The quest queue on the quests page: "do them all" when nothing runs, then the
 * games playing together, the quests waiting for a slot, and how the last run went.
 */
export function QueuePanel({
  quests,
  resolved,
  now,
}: {
  quests: readonly Quest[];
  resolved: ReadonlyMap<string, readonly QuestGame[]>;
  now: number;
}) {
  const { t } = useT();
  const status = useQueueStore((state) => state.status);
  const enqueue = useEnqueueQuests();
  const [confirming, setConfirming] = useState(false);

  const queued = useMemo(() => queuedQuestIds(status), [status]);
  const plan = useMemo(
    () => planQueue(quests, resolved, now).filter((item) => !queued.has(item.questId)),
    [quests, resolved, now, queued],
  );

  if (isQueueActive(status)) return <ActiveQueue status={status} addable={plan} />;

  return (
    <>
      {plan.length > 0 ? (
        <section data-tour="queue-offer" className="flex flex-wrap items-center gap-4 rounded-card bg-surface p-5 shadow-card">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t("queue.offer.title", { count: plan.length })}</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {t("queue.offer.body", { duration: formatDuration(estimatedMinutes(plan) * 60) })}
            </p>
          </div>
          <Button variant="primary" onClick={() => setConfirming(true)}>
            <PlayIcon size={16} />
            {t("queue.offer.cta")}
          </Button>
        </section>
      ) : null}

      <LastRun status={status} />

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={t("queue.confirm.title", { count: plan.length })}
        description={t("queue.confirm.body")}
      >
        <div className="space-y-4 px-6 pb-6 pt-4">
          <ol className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-inner bg-sunken p-2">
            {plan.map((item, index) => (
              <li key={item.questId} className="flex items-center gap-3 px-2 py-1 text-[13px]">
                <span className="w-5 text-right tabular-nums text-subtle">{index + 1}.</span>
                <span className="min-w-0 flex-1 truncate">
                  {item.gameName}
                  <span className="text-muted"> · {item.questName}</span>
                </span>
                <span className="tabular-nums text-muted">{formatDuration(item.minutes * 60)}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-subtle">{t("queue.confirm.total", { duration: formatDuration(estimatedMinutes(plan) * 60) })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={enqueue.isPending}
              onClick={() => {
                enqueue.mutate(plan, {
                  onSuccess: () => {
                    setConfirming(false);
                    toast.success(t("queue.started", { count: plan.length }));
                  },
                });
              }}
            >
              <PlayIcon size={16} />
              {t("queue.confirm.cta", { count: plan.length })}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
