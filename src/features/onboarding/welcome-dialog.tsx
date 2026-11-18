import { useEffect } from "react";

import { TriangleAlertIcon } from "@/components/icons";
import { AppMark } from "@/components/ui/app-mark";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useLibrary } from "@/features/games/queries";
import { useT } from "@/lib/i18n/use-t";

import { useOnboardingStore } from "./onboarding-store";
import { TOUR_STEPS } from "./steps";

const HOW = ["welcome.how1", "welcome.how2", "welcome.how3"] as const;

/**
 * The first screen a new user sees: what the app does in one sentence, how in
 * three steps, and a tour offered rather than imposed. Someone who already uses
 * the app (games in the library) never sees it.
 */
export function WelcomeDialog() {
  const { t } = useT();
  const welcomed = useOnboardingStore((state) => state.welcomed);
  const welcome = useOnboardingStore((state) => state.welcome);
  const hideChecklist = useOnboardingStore((state) => state.hideChecklist);
  const startTour = useOnboardingStore((state) => state.startTour);
  const library = useLibrary();
  const hasGames = (library.data?.length ?? 0) > 0;

  // Not a new user: no welcome, no "first steps" either.
  useEffect(() => {
    if (!welcomed && hasGames) {
      welcome();
      hideChecklist();
    }
  }, [welcomed, hasGames, welcome, hideChecklist]);

  const open = !welcomed && library.isSuccess && !hasGames;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) welcome();
      }}
      title={t("welcome.title")}
      description={t("welcome.body")}
      className="w-[min(92vw,520px)]"
    >
      <div className="space-y-5 px-6 pb-6 pt-4">
        <AppMark className="mx-auto" />
        <ol className="space-y-2.5">
          {HOW.map((step, index) => (
            <li key={step} className="flex items-start gap-3 text-[13px] leading-snug">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold tabular-nums text-accent-text">
                {index + 1}
              </span>
              <span className="pt-0.5">{t(step)}</span>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-xs leading-snug text-warning">
          <TriangleAlertIcon size={16} className="mt-px shrink-0" />
          {t("welcome.risk")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={welcome}>
            {t("welcome.explore")}
          </Button>
          <Button variant="primary" autoFocus onClick={startTour}>
            {t("welcome.tour", { count: TOUR_STEPS.length })}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
