import { create } from "zustand";

import type { LogEntry } from "@/types/domain";

const CAPACITY = 500;

interface LogState {
  entries: LogEntry[];
  replace: (entries: LogEntry[]) => void;
  append: (entry: LogEntry) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  replace: (entries) => {
    set({ entries: entries.slice(-CAPACITY) });
  },
  append: (entry) => {
    set((state) => {
      // The initial snapshot and the live event stream can overlap.
      if (state.entries.some((existing) => existing.id === entry.id)) return state;
      return { entries: [...state.entries, entry].slice(-CAPACITY) };
    });
  },
  clear: () => {
    set({ entries: [] });
  },
}));
