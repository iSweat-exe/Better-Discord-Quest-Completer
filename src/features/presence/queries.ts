import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import type { PresenceRequest } from "@/types/domain";

export function usePresenceStatus() {
  return useQuery({ queryKey: queryKeys.presence, queryFn: ipc.getPresenceStatus });
}

export function usePublishPresence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: PresenceRequest) => ipc.publishPresence(request),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.presence, status);
    },
  });
}

export function useClearPresence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ipc.clearPresence,
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.presence, status);
    },
  });
}
