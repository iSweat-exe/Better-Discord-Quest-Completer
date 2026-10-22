import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { useLogStore } from "@/features/logs/log-store";
import { useVideoStore } from "@/features/quests/video-store";
import { useSessionStore } from "@/features/sessions/session-store";
import { useUpdateStore } from "@/features/update/update-store";
import { EVENTS, subscribe } from "@/lib/events";
import { formatNumber } from "@/lib/format";
import { translate, useLocaleStore } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import type { QuestsResponse } from "@/types/domain";

import { useUiStore } from "./ui-store";

/** Runs every unsubscribe function it is given. */
function unsubscribeAll(unsubscribers: (() => void)[]): () => void {
  return () => {
    unsubscribers.forEach((unsubscribe) => {
      unsubscribe();
    });
  };
}

/** The language in force when a toast is shown, not the one of the render that registered it. */
function currentLocale() {
  return useLocaleStore.getState().locale;
}

/** Running games: the snapshot, then every change, and the toast when a timer completes. */
function useSessionEvents() {
  useEffect(() => {
    const { setSessions } = useSessionStore.getState();
    void ipc.listSessions().then(setSessions);

    return unsubscribeAll([
      subscribe(EVENTS.sessionsChanged, setSessions),
      subscribe(EVENTS.sessionCompleted, (session) => {
        toast.success(
          translate(currentLocale(), "quest.completedToast", {
            game: session.gameName,
            minutes: Math.round(session.targetSeconds / 60),
          }),
        );
      }),
      subscribe(EVENTS.closeRequested, (running) => {
        useUiStore.getState().setClosePrompt(running);
      }),
    ]);
  }, []);
}

/** The activity log: what was already written, then each new line. */
function useLogEvents() {
  useEffect(() => {
    const logs = useLogStore.getState();
    void ipc.getLogs().then(logs.replace);

    return subscribe(EVENTS.appLog, logs.append);
  }, []);
}

/** Updates of the app. */
function useUpdateEvents() {
  useEffect(() => {
    const update = useUpdateStore.getState();
    // The check may have found something before this window was listening.
    void ipc.getPendingUpdate().then(update.setInfo);

    return unsubscribeAll([
      subscribe(EVENTS.updateAvailable, update.setInfo),
      subscribe(EVENTS.updateProgress, update.setProgress),
    ]);
  }, []);
}

/** The games the app knows: the catalog and the library change behind the UI's back. */
function useGamesEvents() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      unsubscribeAll([
        // The game list is shown from local storage at once, then replaced by Discord's.
        subscribe(EVENTS.catalogUpdated, (catalog) => {
          queryClient.setQueryData(queryKeys.catalog, catalog);
          void queryClient.invalidateQueries({ queryKey: queryKeys.library });
        }),
        // Playtime is booked by the backend when a session ends.
        subscribe(EVENTS.libraryChanged, () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.library });
        }),
      ]),
    [queryClient],
  );
}

/** The Discord quests: the backend reads them by itself, so progress arrives without polling here. */
function useQuestEvents() {
  const queryClient = useQueryClient();

  useEffect(
    () =>
      unsubscribeAll([
        subscribe(EVENTS.questsUpdated, (response) => {
          queryClient.setQueryData(queryKeys.quests, response);
        }),
        subscribe(EVENTS.questsDisconnected, () => {
          queryClient.removeQueries({ queryKey: queryKeys.quests });
          queryClient.removeQueries({ queryKey: queryKeys.orbsBalance });
          queryClient.removeQueries({ queryKey: queryKeys.profile });
          queryClient.setQueryData(queryKeys.questsConnection, false);
        }),
        subscribe(EVENTS.statsChanged, () => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.appStats });
        }),
        subscribe(EVENTS.questDone, ({ questId, name }) => {
          const locale = currentLocale();
          const quest = queryClient.getQueryData<QuestsResponse>(queryKeys.quests)?.quests.find((known) => known.id === questId);
          // A reward still to claim is the part worth saying; the title alone is enough otherwise.
          const orbs = quest?.status === "completed" ? quest.rewardOrbs : null;
          toast.success(translate(locale, "quest.confirmedToast", { name }), {
            ...(orbs ? { description: translate(locale, "quest.confirmedReward", { orbs: formatNumber(orbs, locale) }) } : {}),
          });
        }),
      ]),
    [queryClient],
  );
}

/** Videos watched in the background, whatever page is open. */
function useVideoEvents() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // A viewing started before a reload goes on in the backend.
    void ipc.getActiveVideos().then(useVideoStore.getState().replaceAll);

    return unsubscribeAll([
      subscribe(EVENTS.questVideoProgress, useVideoStore.getState().set),
      subscribe(EVENTS.questVideoEnded, ({ questId, name, ok, message }) => {
        useVideoStore.getState().end(questId);
        // Success is told once, by the quest's own confirmation (with its reward): only a failure needs this toast.
        if (!ok) toast.error(translate(currentLocale(), "quests.videoFailed", { name, reason: message ?? "" }));
        void queryClient.invalidateQueries({ queryKey: queryKeys.questRisk });
        void queryClient.invalidateQueries({ queryKey: queryKeys.questActivity });
        void queryClient.invalidateQueries({ queryKey: queryKeys.orbsBalance });
      }),
    ]);
  }, [queryClient]);
}

/** Wires the backend's initial data and live events to the stores and the query cache. */
export function useBackendEvents() {
  useSessionEvents();
  useLogEvents();
  useUpdateEvents();
  useGamesEvents();
  useQuestEvents();
  useVideoEvents();
}
