import { useEffect, type KeyboardEvent } from "react";

import { InfoIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/features/sessions/session-store";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import type { MessageKey } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";

import { useOnboardingStore, type TipId } from "./onboarding-store";
import { useCardPosition, useTargetBox } from "./use-target";

interface Tip {
  id: TipId;
  target: string;
  title: MessageKey;
  body: MessageKey;
}

const TIPS: Record<TipId, Tip> = {
  detection: { id: "detection", target: "detection", title: "tip.detection.title", body: "tip.detection.body" },
  queue: { id: "queue", target: "queue-offer", title: "tip.queue.title", body: "tip.queue.body" },
};

/**
 * The tip worth showing now, if any: each one answers a question at the moment
 * it comes up (the first launch waits for Discord; the quest queue appears) and
 * is shown once. Never during the tour.
 */
function useCurrentTip(): Tip | null {
  const seen = useOnboardingStore((state) => state.tipsSeen);
  const touring = useOnboardingStore((state) => state.tourStep !== null);
  const page = useUiStore((state) => state.page);
  const waiting = useSessionStore((state) => state.sessions.some((session) => session.detection === "waiting"));

  if (touring) return null;
  if (page === "games" && waiting && !seen.includes("detection")) return TIPS.detection;
  if (page === "quests" && !seen.includes("queue")) return TIPS.queue;
  return null;
}

/**
 * A contextual tip: a small callout beside the element it is about, without a
 * dimmed screen and without taking the focus, so it never stands in the way.
 */
export function ContextualTips() {
  const { t } = useT();
  const tip = useCurrentTip();
  const seeTip = useOnboardingStore((state) => state.seeTip);
  const box = useTargetBox(tip?.target ?? null);
  const { cardRef, position } = useCardPosition(box);

  // A tip whose element is not on screen waits for it.
  const visible = tip !== null && box !== null;

  useEffect(() => {
    if (!visible) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && tip) seeTip(tip.id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [visible, tip, seeTip]);

  if (!visible) return null;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="tip-title"
      aria-describedby="tip-body"
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape") seeTip(tip.id);
      }}
      className={cn(
        "fixed z-50 w-72 rounded-card bg-surface p-4 shadow-card ring-1 ring-accent/40",
        position ? "opacity-100 motion-safe:transition-opacity motion-safe:duration-200" : "opacity-0",
      )}
      style={position ?? { top: 0, left: 0 }}
    >
      <p id="tip-title" className="flex items-center gap-2 text-sm font-semibold [&_svg]:size-4 [&_svg]:text-accent-text">
        <InfoIcon aria-hidden="true" />
        {t(tip.title)}
      </p>
      <p id="tip-body" className="mt-1.5 text-[13px] leading-relaxed text-muted">
        {t(tip.body)}
      </p>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => seeTip(tip.id)}>
          {t("tip.gotIt")}
        </Button>
      </div>
    </div>
  );
}
