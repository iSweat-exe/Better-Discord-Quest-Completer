import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** One-time contextual tips, shown at the moment they help (see `tips.tsx`). */
export type TipId = "detection" | "queue";

interface OnboardingState {
  /** The welcome screen was answered (or skipped for someone who already used the app). */
  welcomed: boolean;
  /** Index of the tour step on screen, `null` when no tour runs. */
  tourStep: number | null;
  /** The "first steps" checklist was hidden by the user. */
  checklistHidden: boolean;
  /** The checklist was completed once (its celebration is not repeated). */
  checklistCelebrated: boolean;
  /** A fake game was launched at least once. */
  launchedOnce: boolean;
  /** Discord was seen noticing a fake game at least once. */
  detectedOnce: boolean;
  tipsSeen: TipId[];

  welcome: () => void;
  startTour: () => void;
  goToStep: (step: number) => void;
  endTour: () => void;
  hideChecklist: () => void;
  showChecklist: () => void;
  celebrate: () => void;
  markLaunched: () => void;
  markDetected: () => void;
  seeTip: (tip: TipId) => void;
  resetTips: () => void;
}

/**
 * Where the user stands in their discovery of the app. It only drives what the
 * UI offers (welcome, tour, checklist, tips), so it lives in the WebView's local
 * storage; losing it only means being offered the welcome again.
 */
export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      welcomed: false,
      tourStep: null,
      checklistHidden: false,
      checklistCelebrated: false,
      launchedOnce: false,
      detectedOnce: false,
      tipsSeen: [],

      welcome: () => {
        set({ welcomed: true });
      },
      startTour: () => {
        set({ welcomed: true, tourStep: 0 });
      },
      goToStep: (tourStep) => {
        set({ tourStep });
      },
      endTour: () => {
        set({ tourStep: null });
      },
      hideChecklist: () => {
        set({ checklistHidden: true });
      },
      showChecklist: () => {
        set({ checklistHidden: false });
      },
      celebrate: () => {
        set({ checklistCelebrated: true });
      },
      markLaunched: () => {
        set({ launchedOnce: true });
      },
      markDetected: () => {
        set({ detectedOnce: true, launchedOnce: true });
      },
      seeTip: (tip) => {
        set((state) => (state.tipsSeen.includes(tip) ? state : { tipsSeen: [...state.tipsSeen, tip] }));
      },
      resetTips: () => {
        set({ tipsSeen: [] });
      },
    }),
    {
      name: "dqc-onboarding",
      version: 1,
      // A storage that throws (private mode, blocked site data) leaves the defaults in place.
      storage: createJSONStorage(() => localStorage),
      // The tour on screen is not worth restoring after a reload.
      partialize: (state) => ({
        welcomed: state.welcomed,
        checklistHidden: state.checklistHidden,
        checklistCelebrated: state.checklistCelebrated,
        launchedOnce: state.launchedOnce,
        detectedOnce: state.detectedOnce,
        tipsSeen: state.tipsSeen,
      }),
    },
  ),
);
