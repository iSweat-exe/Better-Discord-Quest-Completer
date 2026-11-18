import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

import { useOnboardingStore } from "./onboarding-store";
import { TOUR_STEPS } from "./steps";
import { useCardPosition, useTargetBox } from "./use-target";

const SPOTLIGHT_PADDING = 6;

/** Keeps Tab and Shift+Tab inside `container`. */
function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>("button:not([disabled])")];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * The guided tour: a spotlight on one element at a time, with a short card.
 * Started by the user (from the welcome screen or the settings), skippable at any
 * step, driven by the keyboard too (arrows, Escape), and it ends on a real action.
 */
export function TourOverlay() {
  const { t } = useT();
  const stepIndex = useOnboardingStore((state) => state.tourStep);
  const goToStep = useOnboardingStore((state) => state.goToStep);
  const endTour = useOnboardingStore((state) => state.endTour);
  const step = stepIndex === null ? undefined : TOUR_STEPS[stepIndex];

  const box = useTargetBox(step?.target ?? null);
  const { cardRef, position } = useCardPosition(box);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // The tour shows each element on its page; the page that had the focus gets it back at the end.
  useEffect(() => {
    if (!step) return;
    useUiStore.getState().navigate(step.page);
  }, [step]);

  const running = step !== undefined;
  useEffect(() => {
    if (!running) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      returnFocus.current?.focus();
    };
  }, [running]);

  useEffect(() => {
    primaryRef.current?.focus();
  }, [stepIndex]);

  const finish = useCallback(() => {
    endTour();
    // Ends on the first thing to do: finding the game a quest asks for.
    const ui = useUiStore.getState();
    ui.navigate("games");
    ui.setSearchOpen(true);
  }, [endTour]);

  if (!step || stepIndex === null) return null;

  const last = stepIndex === TOUR_STEPS.length - 1;
  const next = () => {
    if (last) finish();
    else goToStep(stepIndex + 1);
  };
  const back = () => {
    if (stepIndex > 0) goToStep(stepIndex - 1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      endTour();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      next();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      back();
    } else {
      trapTab(event, cardRef.current);
    }
  };

  return (
    <div className="fixed inset-0 z-[60]" onKeyDown={onKeyDown}>
      {/* Clicks outside the card do nothing: the tour is left with its own buttons or Escape. */}
      <div className={cn("absolute inset-0", !box && "bg-black/60")} aria-hidden="true" />
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent motion-safe:transition-all motion-safe:duration-300 motion-safe:ease-out"
          style={{
            top: box.top - SPOTLIGHT_PADDING,
            left: box.left - SPOTLIGHT_PADDING,
            width: box.width + SPOTLIGHT_PADDING * 2,
            height: box.height + SPOTLIGHT_PADDING * 2,
            boxShadow: "0 0 0 9999px oklch(0 0 0 / 0.6)",
          }}
        />
      ) : null}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={cn(
          "absolute w-80 rounded-card bg-surface p-5 shadow-card",
          position ? "opacity-100 motion-safe:transition-[top,left,opacity] motion-safe:duration-300" : "opacity-0",
        )}
        style={position ?? { top: 0, left: 0 }}
      >
        <p className="text-xs font-medium text-subtle">
          {t("tour.progress", { step: stepIndex + 1, total: TOUR_STEPS.length })}
        </p>
        <div className="mt-1.5 flex gap-1" aria-hidden="true">
          {TOUR_STEPS.map((candidate, index) => (
            <span
              key={candidate.id}
              className={cn("h-1 flex-1 rounded-full", index <= stepIndex ? "bg-accent" : "bg-sunken")}
            />
          ))}
        </div>
        <h2 id="tour-title" className="mt-3 text-base font-semibold tracking-tight">
          {t(step.title)}
        </h2>
        <p id="tour-body" className="mt-1.5 text-[13px] leading-relaxed text-muted">
          {t(step.body)}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={endTour}>
            {last ? t("tour.close") : t("tour.skip")}
          </Button>
          <span className="flex-1" />
          {stepIndex > 0 ? (
            <Button size="sm" onClick={back}>
              {t("tour.back")}
            </Button>
          ) : null}
          <Button ref={primaryRef} size="sm" variant="primary" onClick={next}>
            {last ? t("tour.finish") : t("tour.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
