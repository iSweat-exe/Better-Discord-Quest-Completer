import { CircleAlertIcon, CircleCheckIcon, CircleIcon, ScanSearchIcon } from "@/components/icons";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { Spinner } from "@/components/ui/primitives";
import { useCheckDetection, useDiscordStatus } from "@/features/discord/queries";
import { useSettings } from "@/features/settings/queries";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import type { DetectionReport, SessionInfo } from "@/types/domain";

type Tone = "ok" | "warn" | "neutral";

const TONE_ICON: Record<Tone, ReactNode> = {
  ok: <CircleCheckIcon className="text-success" />,
  warn: <CircleAlertIcon className="text-warning" />,
  neutral: <CircleIcon className="text-subtle" />,
};

function StatusRow({ tone, label, detail }: { tone: Tone; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 text-[13px]">
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{TONE_ICON[tone]}</span>
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        <span className="text-muted"> · {detail}</span>
      </span>
    </li>
  );
}

function ResultMessage({ report, session }: { report: DetectionReport; session: SessionInfo }) {
  const { t, locale } = useT();
  const time = report.detectedAt === null ? "" : formatTime(report.detectedAt, locale);
  const seconds =
    report.detectedAt === null ? 0 : Math.max(0, Math.round((report.detectedAt - session.startedAt) / 1000));

  const message: Record<DetectionReport["state"], { tone: Tone; text: string }> = {
    detected: { tone: "ok", text: t("detect.result.detected", { time, seconds }) },
    reacted: { tone: "neutral", text: t("detect.result.reacted", { time }) },
    waiting: { tone: "neutral", text: t("detect.result.waiting") },
    logUnavailable: { tone: "warn", text: t("detect.result.unavailable") },
  };
  const { tone, text } = message[report.state];

  return (
    <div
      role="status"
      className={cn(
        "mt-3 flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-[13px]",
        tone === "ok" && "bg-success-soft text-success",
        tone === "warn" && "bg-warning-soft text-warning",
        tone === "neutral" && "bg-raised text-muted",
      )}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{TONE_ICON[tone]}</span>
      {text}
    </div>
  );
}

type DiscordStatus = ReturnType<typeof useDiscordStatus>["data"];

/** The three things that must be true for Discord to see a game. */
function CheckList({
  session,
  discord,
  windowMode,
}: {
  session: SessionInfo;
  discord: DiscordStatus;
  windowMode: "normal" | "minimized" | "hidden";
}) {
  const { t } = useT();
  const discordOk = discord?.running === true;

  return (
    <ul className="space-y-2">
      <StatusRow
        tone={discord === undefined ? "neutral" : discordOk ? "ok" : "warn"}
        label={t("detect.discord")}
        detail={
          discordOk
            ? t("detect.discordOk", { client: discord.client ?? "Discord" })
            : discord === undefined
              ? t("common.loading")
              : t("detect.discordKo")
        }
      />
      <StatusRow tone="ok" label={t("detect.process")} detail={t("detect.processOk", { pid: session.pid })} />
      <StatusRow
        tone={windowMode === "normal" ? "ok" : "neutral"}
        label={t("settings.runnerWindow")}
        detail={t(`detect.window.${windowMode}` satisfies MessageKey)}
      />
    </ul>
  );
}

/**
 * Once Discord has seen the game, the checks have done their job: the panel shrinks to the
 * one line that matters, and the checks stay one click away.
 */
function SettledDetection({
  session,
  discord,
  windowMode,
}: {
  session: SessionInfo;
  discord: DiscordStatus;
  windowMode: "normal" | "minimized" | "hidden";
}) {
  const { t, locale } = useT();
  const detectedAt = session.detectedAt ?? session.startedAt;
  const seconds = Math.max(0, Math.round((detectedAt - session.startedAt) / 1000));

  return (
    <details className="group rounded-inner bg-sunken px-4 py-3 text-[13px]">
      <summary className="flex cursor-pointer list-none select-none items-center gap-2.5 rounded-lg text-success">
        <span className="shrink-0 [&_svg]:size-4">{TONE_ICON.ok}</span>
        <span className="min-w-0 flex-1">
          {t("detect.auto.detected", { time: formatTime(detectedAt, locale), seconds })}
        </span>
        <span className="shrink-0 text-muted">
          <DisclosureChevron />
        </span>
      </summary>
      <div className="mt-3">
        <CheckList session={session} discord={discord} windowMode={windowMode} />
      </div>
    </details>
  );
}

/** How often a started check repeats while the game is not detected yet. */
const RECHECK_MS = 10_000;

const TIPS = ["detect.tip1", "detect.tip2", "detect.tip3", "detect.tip4"] as const satisfies readonly MessageKey[];

/** What the automatic check found so far, read from the session itself. */
function AutomaticStatus({ session }: { session: SessionInfo }) {
  const { t, locale } = useT();

  if (session.detection === "detected" && session.detectedAt !== null) {
    const seconds = Math.max(0, Math.round((session.detectedAt - session.startedAt) / 1000));
    return (
      <div role="status" className="mt-4 flex items-start gap-2.5 rounded-lg bg-success-soft px-3 py-2.5 text-[13px] text-success">
        <span className="mt-0.5 shrink-0 [&_svg]:size-4">{TONE_ICON.ok}</span>
        {t("detect.auto.detected", { time: formatTime(session.detectedAt, locale), seconds })}
      </div>
    );
  }

  if (session.detection === "unverifiable") {
    return (
      <div role="status" className="mt-4 flex items-start gap-2.5 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
        <span className="mt-0.5 shrink-0 [&_svg]:size-4">{TONE_ICON.warn}</span>
        {t("detect.result.unavailable")}
      </div>
    );
  }

  return (
    <p role="status" className="mt-4 flex items-start gap-2.5 rounded-lg bg-raised px-3 py-2.5 text-[13px] text-muted">
      <Spinner className="mt-0.5 size-4 shrink-0" />
      {t("detect.auto.waiting")}
    </p>
  );
}

/** Helps answer « why does Discord not show my game? » for one running game. */
export function DetectionPanel({ session }: { session: SessionInfo }) {
  const { t } = useT();
  const { data: discord } = useDiscordStatus();
  const { data: settings } = useSettings();
  const check = useCheckDetection();
  // Once the user asked for a check, keep looking until Discord has seen the game.
  const [watching, setWatching] = useState(false);

  // The backend already watches Discord's log when the timer waits for detection.
  const automatic = session.detection !== "off";
  const detected = check.data?.state === "detected";
  const { mutate: runCheck, isPending: checking } = check;
  useEffect(() => {
    if (automatic || !watching || detected) return;

    const timer = window.setInterval(() => {
      if (!checking) runCheck(session.id);
    }, RECHECK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [automatic, watching, detected, checking, runCheck, session.id]);

  const windowMode = settings?.runnerWindow ?? "normal";

  if (session.detection === "detected" && session.detectedAt !== null) {
    return <SettledDetection session={session} discord={discord} windowMode={windowMode} />;
  }

  return (
    <section aria-labelledby="detect-heading" className="rounded-inner bg-sunken p-4">
      <h3 id="detect-heading" className="text-sm font-semibold tracking-tight">
        {t("detect.title")}
      </h3>
      <p className="mb-3 mt-0.5 text-[13px] text-muted">{t("detect.subtitle")}</p>

      <CheckList session={session} discord={discord} windowMode={windowMode} />

      {automatic ? <AutomaticStatus session={session} /> : null}

      {!automatic ? (
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={check.isPending}
          onClick={() => {
            setWatching(true);
            check.mutate(session.id);
          }}
        >
          {check.isPending ? <Spinner /> : <ScanSearchIcon />}
          {check.isPending ? t("detect.checking") : t("detect.check")}
        </Button>
        <p className="min-w-0 flex-1 text-xs text-subtle">{t("detect.consent")}</p>
      </div>
      ) : null}

      {!automatic && check.data ? <ResultMessage report={check.data} session={session} /> : null}
      {!automatic && watching && !detected ? <p className="mt-2 text-xs text-subtle">{t("detect.watching")}</p> : null}

      <details className="group mt-3 text-[13px] text-muted">
        <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-lg py-1 hover:text-fg">
          <DisclosureChevron />
          {t("detect.tips.title")}
        </summary>
        <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
          {TIPS.map((tip) => (
            <li key={tip}>{t(tip)}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
