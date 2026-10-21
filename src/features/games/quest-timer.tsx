import { CheckIcon } from "@/components/icons";

import { Spinner } from "@/components/ui/primitives";
import { ProgressRing } from "@/components/ui/progress-ring";
import { cn } from "@/lib/cn";
import { formatClock, formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { timerElapsedSeconds } from "@/lib/sessions";
import { useNow } from "@/lib/use-now";
import type { SessionInfo } from "@/types/domain";

/** The timer has not started: Discord has not noticed the game yet. */
function WaitingTimer({ session, now }: { session: SessionInfo; now: number }) {
  const { t } = useT();

  return (
    <div className="flex items-center gap-5 rounded-inner bg-sunken p-4">
      <div className="grid size-[92px] shrink-0 place-items-center rounded-full border-[7px] border-line-strong text-muted">
        <Spinner className="size-6" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("quest.title")}</p>
        <p className="mt-1 text-base font-semibold">{t("quest.waiting.title")}</p>
        <p className="mt-0.5 text-[13px] text-muted">{t("quest.waiting.body")}</p>
        <p className="mt-2 text-xs tabular-nums text-subtle">
          {t("quest.waiting.elapsed", { time: formatClock((now - session.startedAt) / 1000) })}
        </p>
      </div>
    </div>
  );
}

/** Progress of a running game toward the quest's playtime goal. */
export function QuestTimer({ session }: { session: SessionInfo }) {
  const { t, locale } = useT();
  const now = useNow();

  const elapsed = timerElapsedSeconds(session, now);
  if (elapsed === null) return <WaitingTimer session={session} now={now} />;

  const complete = elapsed >= session.targetSeconds;
  const progress = session.targetSeconds > 0 ? elapsed / session.targetSeconds : 1;

  // How the timer's start was decided, so it never looks arbitrary.
  const origin =
    session.detection === "detected" && session.detectedAt !== null
      ? t("quest.detectedAt", { time: formatTime(session.detectedAt, locale) })
      : session.detection === "unverifiable"
        ? t("quest.unverifiable")
        : session.detection === "off"
          ? t("quest.off")
          : null;

  return (
    <div
      className={cn(
        "flex items-center gap-5 rounded-inner p-4 transition-colors duration-300",
        complete ? "bg-success-soft" : "bg-accent-soft",
      )}
    >
      <ProgressRing value={progress} complete={complete} size={92}>
        <span className="text-lg font-semibold tabular-nums tracking-tight">{formatClock(elapsed)}</span>
      </ProgressRing>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t("quest.title")}</p>

        {complete ? (
          <p className="mt-1 flex items-center gap-1.5 text-base font-semibold text-success">
            <CheckIcon size={18} className="[&_svg]:stroke-2" />
            {t("quest.done")}
          </p>
        ) : (
          <p className="mt-1 text-base font-semibold tabular-nums">
            {t("quest.remaining", { time: formatClock(session.targetSeconds - elapsed) })}
          </p>
        )}

        <p className="mt-0.5 text-[13px] text-muted">
          {complete ? t("quest.doneHint") : t("quest.target", { minutes: Math.round(session.targetSeconds / 60) })}
        </p>
        {origin ? <p className="mt-2 text-xs text-subtle">{origin}</p> : null}
        <p className="mt-1 text-xs text-subtle">{t("quest.disclaimer")}</p>
      </div>
    </div>
  );
}
