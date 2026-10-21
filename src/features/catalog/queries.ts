import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";

/** The game catalog. Loading it also refreshes the saved games on the backend. */
export function useCatalog() {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: async () => {
      const catalog = await ipc.getCatalog(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.library });
      return catalog;
    },
  });
}

/** Forces a download from Discord, falling back to the cache when offline. */
export function useRefreshCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => ipc.getCatalog(true),
    onSuccess: async (catalog) => {
      queryClient.setQueryData(queryKeys.catalog, catalog);
      await queryClient.invalidateQueries({ queryKey: queryKeys.library });
    },
  });
}
