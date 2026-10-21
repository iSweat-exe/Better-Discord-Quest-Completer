import { create } from "zustand";

export type Page = "games" | "quests" | "shop" | "presence" | "logs" | "settings" | "profile";

interface UiState {
  page: Page;
  selectedGameId: string | null;
  searchOpen: boolean;
  /** Text the search opens with (e.g. a quest's game title). */
  searchSeed: string;
  /** Number of running games when the user tried to close the window. */
  closePrompt: number | null;
  /** The Rich Presence risk warning was accepted during this run. */
  presenceRiskAccepted: boolean;

  navigate: (page: Page) => void;
  selectGame: (gameId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  openSearch: (seed: string) => void;
  setClosePrompt: (runningCount: number | null) => void;
  acceptPresenceRisk: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  page: "games",
  selectedGameId: null,
  searchOpen: false,
  searchSeed: "",
  closePrompt: null,
  presenceRiskAccepted: false,

  navigate: (page) => {
    set({ page });
  },
  selectGame: (selectedGameId) => {
    set({ selectedGameId, page: "games" });
  },
  setSearchOpen: (searchOpen) => {
    set({ searchOpen, searchSeed: "" });
  },
  openSearch: (searchSeed) => {
    set({ searchOpen: true, searchSeed });
  },
  setClosePrompt: (closePrompt) => {
    set({ closePrompt });
  },
  acceptPresenceRisk: () => {
    set({ presenceRiskAccepted: true });
  },
}));
