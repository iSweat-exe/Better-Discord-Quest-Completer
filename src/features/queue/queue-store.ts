import { create } from "zustand";

import { EMPTY_QUEUE } from "@/lib/queue";
import type { QueueStatus } from "@/types/domain";

interface QueueState {
  status: QueueStatus;
  setStatus: (status: QueueStatus) => void;
}

/** Mirror of the backend's quest queue, kept fresh by `queue-changed`. */
export const useQueueStore = create<QueueState>((set) => ({
  status: EMPTY_QUEUE,
  setStatus: (status) => {
    set({ status });
  },
}));
