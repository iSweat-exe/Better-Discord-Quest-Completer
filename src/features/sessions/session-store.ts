import { create } from "zustand";

import type { SessionInfo } from "@/types/domain";

interface SessionState {
  sessions: SessionInfo[];
  setSessions: (sessions: SessionInfo[]) => void;
}

/** Mirror of the backend's running sessions, kept fresh by `sessions-changed`. */
export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  setSessions: (sessions) => {
    set({ sessions });
  },
}));
