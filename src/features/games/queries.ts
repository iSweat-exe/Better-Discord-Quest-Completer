import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import type { LibraryEntry } from "@/types/domain";

export function useLibrary() {
  return useQuery({ queryKey: queryKeys.library, queryFn: ipc.getLibrary });
}

export function useAddToLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (gameId: string) => ipc.addToLibrary(gameId),
    onSuccess: (entries) => {
      queryClient.setQueryData<LibraryEntry[]>(queryKeys.library, entries);
    },
  });
}

export function useRemoveFromLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (gameId: string) => ipc.removeFromLibrary(gameId),
    onSuccess: async (entries) => {
      queryClient.setQueryData<LibraryEntry[]>(queryKeys.library, entries);
      // The game's folder was deleted with it.
      await queryClient.invalidateQueries({ queryKey: queryKeys.storage });
    },
  });
}

export function useImportLibrary() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (json: string) => ipc.importLibrary(json),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.library });
    },
  });
}

/** Opens the file manager on a game's fake executable. */
export function useRevealExecutable() {
  return useMutation({
    mutationFn: ({ gameId, executable }: { gameId: string; executable: string }) =>
      ipc.revealExecutable(gameId, executable),
  });
}
