import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { PlayIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/use-t";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";

/** What a closed app left running; refreshed by the `resume-changed` event. */
function useInterruptedRun() {
  return useQuery({ queryKey: queryKeys.interruptedRun, queryFn: ipc.getInterruptedRun, staleTime: Infinity });
}

function useResume() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ipc.resumeInterruptedRun,
    onSettled: () => queryClient.setQueryData(queryKeys.interruptedRun, null),
  });
}

function useDismiss() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ipc.dismissInterruptedRun,
    onSuccess: () => queryClient.setQueryData(queryKeys.interruptedRun, null),
  });
}

/**
 * Offers to pick up what was running when the app closed (quit, crash, Windows
 * restart, update): each game with the time its timer still had, and the queue.
 */
export function ResumeBanner() {
  const { t } = useT();
  const { data: run } = useInterruptedRun();
  const resume = useResume();
  const dismiss = useDismiss();

  if (!run) return null;

  const games = run.games.map((game) => t("resume.game", { name: game.gameName, minutes: game.remainingMinutes }));
  const parts = [
    ...(games.length > 0 ? [t("resume.games", { count: games.length, list: games.join(", ") })] : []),
    ...(run.queuedQuests > 0 ? [t("resume.queue", { count: run.queuedQuests })] : []),
  ];

  return (
    <div
      role="region"
      aria-label={t("resume.title")}
      className="mx-8 mt-5 flex flex-wrap items-center gap-3 rounded-card bg-accent-soft px-4 py-3 text-[13px] shadow-card"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-accent-text">{t("resume.title")}</p>
        <p className="mt-0.5 text-muted">{parts.join(" · ")}</p>
      </div>
      <Button size="sm" variant="ghost" disabled={dismiss.isPending || resume.isPending} onClick={() => dismiss.mutate()}>
        {t("resume.dismiss")}
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={resume.isPending || dismiss.isPending}
        onClick={() => {
          resume.mutate(undefined, {
            onSuccess: (count) => {
              toast.success(t("resume.done", { count }));
            },
          });
        }}
      >
        <PlayIcon size={16} />
        {t("resume.cta")}
      </Button>
    </div>
  );
}
