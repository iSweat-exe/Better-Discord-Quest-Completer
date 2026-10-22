import type { CSSProperties } from "react";

import { CheckIcon, ClockIcon } from "@/components/icons";

import { ProgressRing } from "@/components/ui/progress-ring";
import { cn } from "@/lib/cn";
import { formatClock, formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { timerElapsedSeconds } from "@/lib/sessions";
import { useNow } from "@/lib/use-now";
import type { SessionInfo } from "@/types/domain";

/** The ring is the timer: the one large figure of the page, so it is the first thing the eye lands on. */
const RING_SIZE = 132;
const RING_STROKE = 8;

/** The timer has not started: Discord has not noticed the game yet. */
function WaitingTimer({ session, now }: { session: SessionInfo; now: number }) {
  const { t } = useT();

  return (
    <div className="flex items-center gap-6 rounded-inner bg-sunken p-5">
      {/* The same breath as the running game's dot in the sidebar: alive, and nothing to do. */}
      <div
        className="grid shrink-0 animate-breathe place-items-center rounded-full border-line-strong text-muted motion-reduce:animate-none"
        style={{ width: RING_SIZE, height: RING_SIZE, borderWidth: RING_STROKE }}
      >
        <ClockIcon size={28} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-muted">{t("quest.title")}</p>
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
export function QuestTimer({ session, hue = null }: { session: SessionInfo; hue?: number | null }) {
  const { t, locale } = useT();
  const now = useNow();

  const elapsed = timerElapsedSeconds(session, now);
  if (elapsed === null) return <WaitingTimer session={session} now={now} />;

  const complete = elapsed >= session.targetSeconds;
  const progress = session.targetSeconds > 0 ? elapsed / session.targetSeconds : 1;
  const remaining = formatClock(Math.max(0, session.targetSeconds - elapsed));

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
        "flex items-center gap-6 rounded-inner p-5 transition-colors duration-300",
        complete ? "bg-success-soft" : "game-tint",
      )}
      style={hue === null ? undefined : ({ "--game-hue": Math.round(hue) } as CSSProperties)}
    >
      <ProgressRing
        value={progress}
        complete={complete}
        size={RING_SIZE}
        strokeWidth={RING_STROKE}
        tinted
        label={complete ? t("quest.done") : t("quest.remaining", { time: remaining })}
      >
        {complete ? (
          <CheckIcon size={44} className="text-success [&_svg]:stroke-2" />
        ) : (
          <span className="flex flex-col items-center leading-none">
            <span className="text-[28px] font-semibold tabular-nums tracking-tight">{remaining}</span>
            <span className="mt-1.5 text-xs text-muted">{t("quest.leftLabel")}</span>
          </span>
        )}
      </ProgressRing>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-muted">{t("quest.title")}</p>

        <p className={cn("mt-1 text-base font-semibold", complete && "text-success")}>
          {complete ? t("quest.done") : t("quest.target", { minutes: Math.round(session.targetSeconds / 60) })}
        </p>

        {complete ? <p className="mt-0.5 text-[13px] text-muted">{t("quest.doneHint")}</p> : null}
        {origin ? <p className="mt-2 text-xs text-subtle">{origin}</p> : null}
        <p className="mt-1 text-xs text-subtle">{t("quest.disclaimer")}</p>
      </div>
    </div>
  );
}
