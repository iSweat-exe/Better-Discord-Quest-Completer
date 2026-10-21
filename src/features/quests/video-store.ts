import { create } from "zustand";

import type { VideoProgress } from "@/types/domain";

interface VideoState {
  /** The videos the backend is watching right now, by quest id. */
  progress: Record<string, VideoProgress>;
  /** A viewing just started: no second was reported yet. */
  begin: (questId: string) => void;
  set: (progress: VideoProgress) => void;
  end: (questId: string) => void;
  replaceAll: (all: VideoProgress[]) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  progress: {},

  begin: (questId) => {
    set((state) =>
      questId in state.progress ? state : { progress: { ...state.progress, [questId]: { questId, seconds: 0, target: 0 } } },
    );
  },
  set: (next) => {
    set((state) => ({ progress: { ...state.progress, [next.questId]: next } }));
  },
  end: (questId) => {
    set((state) => {
      const rest = { ...state.progress };
      delete rest[questId];
      return { progress: rest };
    });
  },
  replaceAll: (all) => {
    set({ progress: Object.fromEntries(all.map((video) => [video.questId, video])) });
  },
}));
