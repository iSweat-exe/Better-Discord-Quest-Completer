import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import type { Settings, SettingsPatch } from "@/types/domain";

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: ipc.getSettings });
}

/** Applies the patch immediately and rolls back if the backend refuses it. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: SettingsPatch) => ipc.updateSettings(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.settings });
      const previous = queryClient.getQueryData<Settings>(queryKeys.settings);
      if (previous) {
        queryClient.setQueryData<Settings>(queryKeys.settings, { ...previous, ...patch });
      }
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.settings, context.previous);
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
    },
  });
}

export function useAppInfo() {
  return useQuery({ queryKey: queryKeys.appInfo, queryFn: ipc.getAppInfo });
}

export function useStorageInfo() {
  return useQuery({ queryKey: queryKeys.storage, queryFn: ipc.getStorageInfo, staleTime: 0 });
}

export function useCleanStorage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ipc.cleanStorage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.storage });
    },
  });
}
