import { useQuery } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";

/** What the app itself helped complete. The backend announces changes (`stats-changed`). */
export function useAppStats() {
  return useQuery({ queryKey: queryKeys.appStats, queryFn: ipc.getAppStats });
}
