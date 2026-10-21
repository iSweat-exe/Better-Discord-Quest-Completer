import { MutationCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/lib/errors";
import { translate, useLocaleStore } from "@/lib/i18n";

/**
 * Cache keys. All of this data lives in the Rust backend: it only changes
 * through our own mutations, so it never goes stale on its own.
 */
export const queryKeys = {
  appInfo: ["app-info"],
  catalog: ["catalog"],
  library: ["library"],
  settings: ["settings"],
  storage: ["storage"],
  presence: ["presence"],
  discord: ["discord-status"],
  quests: ["quests"],
  questsConnection: ["quests-connection"],
  orbsBalance: ["orbs-balance"],
  orbsShop: ["orbs-shop"],
  profile: ["profile"],
  appStats: ["app-stats"],
  questRisk: ["quest-risk"],
  questActivity: ["quest-activity"],
  interruptedVideos: ["interrupted-videos"],
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
      },
    },
    // Every failed command surfaces as a toast, localized by error kind.
    mutationCache: new MutationCache({
      onError: (error) => {
        const locale = useLocaleStore.getState().locale;
        toast.error(errorMessage(error, (key, params) => translate(locale, key, params)));
      },
    }),
  });
}
