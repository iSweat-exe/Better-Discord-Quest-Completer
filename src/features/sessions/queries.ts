import { useMutation } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";

// The backend broadcasts `sessions-changed` after each of these commands, so
// the session store updates itself: no cache handling is needed here.

interface Target {
  gameId: string;
  executable: string;
  /** Quest timer length for this session; the setting applies when omitted. */
  targetMinutes?: number | undefined;
}

export function useStartSession() {
  return useMutation({
    mutationFn: ({ gameId, executable, targetMinutes }: Target) => ipc.startSession(gameId, executable, targetMinutes),
  });
}

/** Starts several games at once; reports the first failure after trying them all. */
export function useLaunchAll() {
  return useMutation({
    mutationFn: async (targets: Target[]) => {
      const results = await Promise.allSettled(
        targets.map(({ gameId, executable, targetMinutes }) => ipc.startSession(gameId, executable, targetMinutes)),
      );
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    },
  });
}

export function useStopSession() {
  return useMutation({ mutationFn: (sessionId: string) => ipc.stopSession(sessionId) });
}

export function useStopAllSessions() {
  return useMutation({ mutationFn: ipc.stopAllSessions });
}
