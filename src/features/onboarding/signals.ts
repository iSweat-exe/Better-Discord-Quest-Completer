import { useEffect } from "react";

import { useSessionStore } from "@/features/sessions/session-store";

import { useOnboardingStore } from "./onboarding-store";

/** Ticks the checklist from what really happens: a game launched, Discord noticing it. */
export function useOnboardingSignals() {
  useEffect(
    () =>
      useSessionStore.subscribe(({ sessions }) => {
        if (sessions.length === 0) return;
        const onboarding = useOnboardingStore.getState();
        if (!onboarding.launchedOnce) onboarding.markLaunched();
        if (!onboarding.detectedOnce && sessions.some((session) => session.detection === "detected")) onboarding.markDetected();
      }),
    [],
  );
}
