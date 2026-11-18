import { useMutation } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import type { QueueItem } from "@/types/domain";

import { useQueueStore } from "./queue-store";

// The backend broadcasts `queue-changed` after each of these commands, so the
// queue store updates itself; the answer of `enqueue` is applied at once anyway.

export function useEnqueueQuests() {
  return useMutation({
    mutationFn: (items: QueueItem[]) => ipc.enqueueQuests(items),
    onSuccess: (status) => {
      useQueueStore.getState().setStatus(status);
    },
  });
}

export function useSkipQueueItem() {
  return useMutation({ mutationFn: ipc.skipQueueItem });
}

export function useStopQueue() {
  return useMutation({ mutationFn: ipc.stopQueue });
}

export function useRemoveFromQueue() {
  return useMutation({ mutationFn: (questId: string) => ipc.removeFromQueue(questId) });
}
