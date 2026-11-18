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

const PRIMARY_REFRESH_MS = 10_000;

/** The game Discord puts forward, read from its log while fake games run. */
export function usePrimaryGame(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.primaryGame,
    queryFn: ipc.getPrimaryGame,
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? PRIMARY_REFRESH_MS : false,
  });
}

/** Asks Discord's own log whether it noticed the game of a session. */
export function useCheckDetection() {
  return useMutation({ mutationFn: (sessionId: string) => ipc.checkDetection(sessionId) });
}
