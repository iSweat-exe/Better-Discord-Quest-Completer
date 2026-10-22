import { useState } from "react";

import { Clapperboard } from "lucide-react";
import { toast } from "sonner";

import { TrophyIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useQuestAction, useQuestRisk, useVideoProgress, type QuestAction } from "@/features/quests/queries";
import { formatDuration } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import { isVideoQuest, type QuestState } from "@/lib/quests";
import type { Quest } from "@/types/domain";

/** The writes on the account: accept, complete the video, claim the reward. Each one is a click on this quest, confirmed first. */
export function AccountActions({ quest, state }: { quest: Quest; state: QuestState }) {
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
        className="tabular-nums"
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
      {live ? <ProgressBar value={live.seconds / Math.max(1, live.target)} motion="duration-1000 ease-linear" className="basis-full" /> : null}
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
