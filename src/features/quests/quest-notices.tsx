import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";

import { ClockIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import { expiringSoon, isOpen, isVideoQuest, objectiveTask, questState } from "@/lib/quests";
import type { Quest } from "@/types/domain";

import { useInterruptedVideos, useQuestAction } from "./queries";
import { useVideoStore } from "./video-store";

/** Open quests that run out in less than a day: the ones not to forget. */
export function ExpiryNotice({ quests, now }: { quests: Quest[]; now: number }) {
  const { t, locale } = useT();
  const soon = expiringSoon(quests, now);
  if (soon.length === 0) return null;

  return (
    <section role="status" className="rounded-card bg-warning-soft p-4 text-warning">
      <div className="flex items-start gap-3">
        <ClockIcon size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("quests.expiring.title", { count: soon.length })}</h2>
          <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px]">
            {soon.map((quest) => (
              <li key={quest.id} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{quest.name}</span>
                {quest.expiresAt !== null ? (
                  <span className="opacity-80">{formatRelativeTime(quest.expiresAt, now, locale)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Videos that were being watched when the app was closed: Discord kept the progress, so they can go on. */
export function InterruptedNotice({ quests, now }: { quests: Quest[]; now: number }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const { data: ids = [] } = useInterruptedVideos();
  const resume = useQuestAction("watchVideo");
  const watching = useVideoStore((state) => state.progress);

  const resumable = quests.filter(
    (quest) =>
      ids.includes(quest.id) && isVideoQuest(quest) && isOpen(questState(quest, now)) && !(quest.id in watching),
  );
  if (resumable.length === 0) return null;

  const forget = (questId?: string) => {
    queryClient.setQueryData<string[]>(queryKeys.interruptedVideos, (current = []) =>
      questId === undefined ? [] : current.filter((id) => id !== questId),
    );
  };

  return (
    <section role="status" className="rounded-card bg-accent-soft p-4 text-accent-text">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Clapperboard size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("quests.interrupted.title", { count: resumable.length })}</h2>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-[13px]">
              {resumable.map((quest) => {
                const target = objectiveTask(quest)?.targetSeconds ?? 0;
                return (
                  <li key={quest.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{quest.name}</span>
                    <span className="tabular-nums opacity-80">
                      {formatDuration(quest.progressSeconds ?? 0)} / {formatDuration(target)}
                    </span>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={resume.isPending}
                      onClick={() => {
                        resume.mutate(quest.id, {
                          onSuccess: () => {
                            forget(quest.id);
                          },
                        });
                      }}
                    >
                      {t("quests.interrupted.resume")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            void ipc.dismissInterruptedVideos().then(() => {
              forget();
            });
          }}
        >
          {t("quests.interrupted.dismiss")}
        </Button>
      </div>
    </section>
  );
}
