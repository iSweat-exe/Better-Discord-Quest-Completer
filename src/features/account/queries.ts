import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useQuestsConnection } from "@/features/quests/queries";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import type { AccountDetails, Guild, ProfileEdit } from "@/types/domain";

/** The account changes rarely and only through our own mutations, besides edits made in Discord. */
const ACCOUNT_FRESH_MS = 10 * 60_000;

/** The account in detail. Only asked for while a token is saved. */
export function useAccount() {
  const { data: connected } = useQuestsConnection();
  return useQuery({ queryKey: queryKeys.account, queryFn: ipc.getAccount, enabled: connected === true, staleTime: ACCOUNT_FRESH_MS });
}

/** The servers the account is in. */
export function useGuilds() {
  const { data: connected } = useQuestsConnection();
  return useQuery({ queryKey: queryKeys.guilds, queryFn: ipc.getGuilds, enabled: connected === true, staleTime: ACCOUNT_FRESH_MS });
}

/** A write counts in the risk level even when it failed halfway. */
function refreshRisk(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.questRisk });
  void queryClient.invalidateQueries({ queryKey: queryKeys.questActivity });
}

/** Changes the display name, bio or pronouns. Call it only once the user confirmed. */
export function useEditProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (edit: ProfileEdit) => ipc.editProfile(edit),
    onSuccess: (account) => {
      queryClient.setQueryData<AccountDetails>(queryKeys.account, account);
      // The sidebar and the header show the display name.
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
    onSettled: () => {
      refreshRisk(queryClient);
    },
  });
}

/** Leaves a server. Call it only once the user confirmed. */
export function useLeaveGuild() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (guild: Guild) => ipc.leaveGuild(guild.id, guild.name),
    onSuccess: (_, guild) => {
      queryClient.setQueryData<Guild[]>(queryKeys.guilds, (guilds) => guilds?.filter((item) => item.id !== guild.id));
    },
    onSettled: () => {
      refreshRisk(queryClient);
    },
  });
}
