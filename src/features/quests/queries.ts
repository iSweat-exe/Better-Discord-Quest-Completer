import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import type { QuestsResponse, VideoProgress } from "@/types/domain";

import { useVideoStore } from "./video-store";

const QUESTS_FRESH_MS = 5 * 60_000;
const SHOP_FRESH_MS = 15 * 60_000;
const PROFILE_FRESH_MS = 30 * 60_000;

const questsOptions = { queryKey: queryKeys.quests, queryFn: ipc.refreshQuests, staleTime: QUESTS_FRESH_MS } as const;

/** Whether a Discord token is saved (the token itself never reaches the frontend). */
export function useQuestsConnection() {
  return useQuery({ queryKey: queryKeys.questsConnection, queryFn: ipc.getQuestsConnection });
}

export function useQuests() {
  return useQuery(questsOptions);
}

/**
 * Starts loading the quests before their page opens (e.g. when the pointer
 * reaches its menu entry), so the list is there on arrival. Does nothing
 * without a token, or while the data is still fresh.
 */
export function usePrefetchQuests() {
  const queryClient = useQueryClient();

  return () => {
    if (queryClient.getQueryData(queryKeys.questsConnection) === true) {
      void queryClient.prefetchQuery(questsOptions);
    }
  };
}

/** Who the saved token belongs to. Only asked for while a token is saved. */
export function useProfile() {
  const { data: connected } = useQuestsConnection();
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: ipc.getProfile,
    enabled: connected === true,
    staleTime: PROFILE_FRESH_MS,
  });
}

/**
 * The Orbs the account holds. It is a nicety: when Discord does not answer, the
 * query just errors and the UI shows nothing instead of an error.
 */
export function useOrbsBalance() {
  return useQuery({ queryKey: queryKeys.orbsBalance, queryFn: ipc.getOrbsBalance, staleTime: QUESTS_FRESH_MS });
}

/** What the Orbs shop sells. Needs a saved token; the shop changes rarely, so it stays fresh a while. */
export function useOrbsShop() {
  const { data: connected } = useQuestsConnection();
  return useQuery({
    queryKey: queryKeys.orbsShop,
    queryFn: ipc.getOrbsShop,
    enabled: connected === true,
    staleTime: SHOP_FRESH_MS,
  });
}

/** Sends the token once: it is checked, stored by the backend and forgotten here. */
export function useConnectQuests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => ipc.connectQuests(token),
    // The variables hold the token: drop the mutation as soon as nobody observes it,
    // instead of keeping it in the cache for the default five minutes.
    gcTime: 0,
    onSuccess: (response) => {
      queryClient.setQueryData<QuestsResponse>(queryKeys.quests, response);
      queryClient.setQueryData(queryKeys.questsConnection, true);
    },
  });
}

export type QuestAction = "enroll" | "claim" | "watchVideo";

/** What an action answers: the reloaded list, or nothing for a viewing that goes on in the background. */
const QUEST_ACTIONS: Record<QuestAction, (questId: string) => Promise<QuestsResponse | undefined>> = {
  enroll: ipc.enrollQuest,
  claim: ipc.claimQuestReward,
  watchVideo: async (questId) => {
    await ipc.watchQuestVideo(questId);
    useVideoStore.getState().begin(questId);
    return undefined;
  },
};

/** Accepts, claims or starts watching one quest: the answer is the reloaded list (a viewing ends later, by event). */
export function useQuestAction(action: QuestAction) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: QUEST_ACTIONS[action],
    onSuccess: (response) => {
      if (response) queryClient.setQueryData<QuestsResponse>(queryKeys.quests, response);
      void queryClient.invalidateQueries({ queryKey: queryKeys.orbsBalance });
    },
    // A write that failed halfway may still have counted.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.questRisk });
      void queryClient.invalidateQueries({ queryKey: queryKeys.questActivity });
    },
  });
}

/** How suspicious the recent writes on the account look. */
export function useQuestRisk() {
  return useQuery({ queryKey: queryKeys.questRisk, queryFn: ipc.getQuestRisk, staleTime: Infinity });
}

/** The writes made on the account, newest first: what makes the risk level rise. */
export function useQuestActivity() {
  return useQuery({ queryKey: queryKeys.questActivity, queryFn: ipc.getQuestActivity, staleTime: Infinity });
}

/** The seconds of a video quest reported so far while the app is watching it, `null` otherwise. */
export function useVideoProgress(questId: string): VideoProgress | null {
  return useVideoStore((state) => state.progress[questId] ?? null);
}

/** The videos that were being watched when the app was last closed. */
export function useInterruptedVideos() {
  return useQuery({ queryKey: queryKeys.interruptedVideos, queryFn: ipc.getInterruptedVideos, staleTime: Infinity });
}

export function useDisconnectQuests() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ipc.disconnectQuests,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.quests });
      queryClient.removeQueries({ queryKey: queryKeys.orbsBalance });
      queryClient.removeQueries({ queryKey: queryKeys.orbsShop });
      queryClient.removeQueries({ queryKey: queryKeys.profile });
      queryClient.setQueryData(queryKeys.questsConnection, false);
    },
  });
}
