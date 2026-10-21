import { useMutation, useQuery } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";

const STATUS_REFRESH_MS = 15_000;

/** Whether a Discord desktop client is running, refreshed while the app is open. */
export function useDiscordStatus() {
  return useQuery({
    queryKey: queryKeys.discord,
    queryFn: ipc.getDiscordStatus,
    staleTime: 0,
    refetchInterval: STATUS_REFRESH_MS,
  });
}

/** Asks Discord's own log whether it noticed the game of a session. */
export function useCheckDetection() {
  return useMutation({ mutationFn: (sessionId: string) => ipc.checkDetection(sessionId) });
}
