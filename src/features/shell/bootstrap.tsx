import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

import { useVideoStore } from "@/features/quests/video-store";
import { useLogStore } from "@/features/logs/log-store";
import { useUpdateStore } from "@/features/update/update-store";
import { useSessionStore } from "@/features/sessions/session-store";
import { useCatalog } from "@/features/catalog/queries";
import { useSettings } from "@/features/settings/queries";
import { EVENTS, subscribe } from "@/lib/events";
import { whenIdle } from "@/lib/idle";
import { resolveLocale, translate, useLocaleStore } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import { warmUpQuestLookup } from "@/lib/quests";
import { warmUpSearch } from "@/lib/search";

import { useUiStore } from "./ui-store";

type ResolvedTheme = "light" | "dark";

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)");

function resolveTheme(theme: "system" | ResolvedTheme): ResolvedTheme {
  if (theme !== "system") return theme;
  return prefersDark().matches ? "dark" : "light";
}

/**
 * Wires the backend to the UI: initial data, live events, theme, language and
 * the global keyboard shortcut. Renders nothing.
 */
export function Bootstrap() {
  const { data: settings } = useSettings();
  const queryClient = useQueryClient();
  const setLocale = useLocaleStore((state) => state.setLocale);

  // Initial snapshots, then live updates.
  useEffect(() => {
    const { setSessions } = useSessionStore.getState();
    const logs = useLogStore.getState();
    const update = useUpdateStore.getState();

    void ipc.listSessions().then(setSessions);
    void ipc.getLogs().then(logs.replace);
    // The check may have found something before this window was listening.
    void ipc.getPendingUpdate().then(update.setInfo);
    // A viewing started before a reload goes on in the backend.
    void ipc.getActiveVideos().then(useVideoStore.getState().replaceAll);

    const unsubscribers = [
      subscribe(EVENTS.sessionsChanged, setSessions),
      subscribe(EVENTS.appLog, logs.append),
      subscribe(EVENTS.sessionCompleted, (session) => {
        const locale = useLocaleStore.getState().locale;
        toast.success(
          translate(locale, "quest.completedToast", {
            game: session.gameName,
            minutes: Math.round(session.targetSeconds / 60),
          }),
        );
      }),
      // The game list is shown from local storage at once, then replaced by Discord's.
      subscribe(EVENTS.catalogUpdated, (catalog) => {
        queryClient.setQueryData(queryKeys.catalog, catalog);
        void queryClient.invalidateQueries({ queryKey: queryKeys.library });
      }),
      // The backend reads the quests by itself: progress arrives without polling here.
      subscribe(EVENTS.questsUpdated, (response) => {
        queryClient.setQueryData(queryKeys.quests, response);
      }),
      subscribe(EVENTS.questsDisconnected, () => {
        queryClient.removeQueries({ queryKey: queryKeys.quests });
        queryClient.removeQueries({ queryKey: queryKeys.orbsBalance });
        queryClient.removeQueries({ queryKey: queryKeys.profile });
        queryClient.setQueryData(queryKeys.questsConnection, false);
      }),
      subscribe(EVENTS.updateAvailable, update.setInfo),
      subscribe(EVENTS.updateProgress, update.setProgress),
      subscribe(EVENTS.statsChanged, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.appStats });
      }),
      subscribe(EVENTS.questDone, ({ name }) => {
        const locale = useLocaleStore.getState().locale;
        toast.success(translate(locale, "quest.confirmedToast", { name }));
      }),
      // A video is watched in the background, whatever page is open.
      subscribe(EVENTS.questVideoProgress, useVideoStore.getState().set),
      subscribe(EVENTS.questVideoEnded, ({ questId, name, ok, message }) => {
        useVideoStore.getState().end(questId);
        const locale = useLocaleStore.getState().locale;
        if (ok) toast.success(translate(locale, "quests.videoDoneNamed", { name }));
        else toast.error(translate(locale, "quests.videoFailed", { name, reason: message ?? "" }));
        void queryClient.invalidateQueries({ queryKey: queryKeys.questRisk });
        void queryClient.invalidateQueries({ queryKey: queryKeys.questActivity });
        void queryClient.invalidateQueries({ queryKey: queryKeys.orbsBalance });
      }),
      subscribe(EVENTS.closeRequested, (running) => {
        useUiStore.getState().setClosePrompt(running);
      }),
      // Playtime is booked by the backend when a session ends.
      subscribe(EVENTS.libraryChanged, () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.library });
      }),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
    };
  }, [queryClient]);

  // Show the quests as last seen right away: the page then never waits for Discord,
  // and refreshes behind the scenes once the data is older than its freshness window.
  useEffect(() => {
    void ipc.getCachedQuests().then((cached) => {
      if (cached && queryClient.getQueryData(queryKeys.quests) === undefined) {
        queryClient.setQueryData(queryKeys.quests, cached, { updatedAt: cached.fetchedAt });
      }
    });
  }, [queryClient]);

  // The first search over ten thousand games takes a moment: pay for it while idle,
  // not during the first page change that needs it (the quests page matches games).
  const games = useCatalog().data?.games;
  useEffect(() => {
    if (!games) return;
    return whenIdle(() => {
      warmUpSearch(games);
      warmUpQuestLookup(games);
    });
  }, [games]);

  // Language.
  const language = settings?.language;
  useEffect(() => {
    if (language) setLocale(resolveLocale(language, navigator.language));
  }, [language, setLocale]);

  const locale = useLocaleStore((state) => state.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Theme: follow the system until the user picks one.
  const theme = settings?.theme;
  useEffect(() => {
    if (!theme) return;

    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
    };
    apply();

    if (isTauri()) {
      void getCurrentWindow().setTheme(theme === "system" ? null : theme);
    }

    if (theme !== "system") return;
    const media = prefersDark();
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
    };
  }, [theme]);

  // The window starts hidden so it never flashes with the wrong theme; the
  // backend then decides whether to show it (not when started in the tray).
  const ready = settings !== undefined;
  useEffect(() => {
    if (ready && isTauri()) void ipc.windowReady();
  }, [ready]);

  // Ctrl/Cmd+K opens the game search; Ctrl/Cmd+1..5 switch pages.
  useEffect(() => {
    const pages = ["games", "quests", "presence", "logs", "settings"] as const;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        const ui = useUiStore.getState();
        ui.navigate("games");
        ui.setSearchOpen(true);
        return;
      }

      const page = pages[Number.parseInt(event.key, 10) - 1];
      if (page) {
        event.preventDefault();
        useUiStore.getState().navigate(page);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
