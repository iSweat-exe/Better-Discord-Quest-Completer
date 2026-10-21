import { create } from "zustand";

import type { DownloadProgress, UpdateInfo } from "@/types/domain";

export type UpdatePhase = "idle" | "checking" | "downloading";

interface UpdateState {
  /** The newer version that was found, if any. */
  info: UpdateInfo | null;
  phase: UpdatePhase;
  progress: DownloadProgress | null;
  dialogOpen: boolean;

  setInfo: (info: UpdateInfo | null) => void;
  setPhase: (phase: UpdatePhase) => void;
  setProgress: (progress: DownloadProgress | null) => void;
  setDialogOpen: (open: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  info: null,
  phase: "idle",
  progress: null,
  dialogOpen: false,

  setInfo: (info) => {
    set({ info });
  },
  setPhase: (phase) => {
    set(phase === "downloading" ? { phase } : { phase, progress: null });
  },
  setProgress: (progress) => {
    set({ progress });
  },
  setDialogOpen: (dialogOpen) => {
    set({ dialogOpen });
  },
}));

/** 0–100, or `null` while the size of the download is not known. */
export function downloadPercent(progress: DownloadProgress | null): number | null {
  if (!progress?.total) return null;
  return Math.min(100, Math.floor((progress.downloaded / progress.total) * 100));
}
