import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useCatalog } from "@/features/catalog/queries";
import { useSettings } from "@/features/settings/queries";
import { whenIdle } from "@/lib/idle";
import { resolveLocale, useLocaleStore } from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import { warmUpQuestLookup } from "@/lib/quests";
import { warmUpSearch } from "@/lib/search";

import { useBackendEvents } from "./backend-events";
import { pageForKeys } from "./shortcuts";
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
  useBackendEvents();

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

  // Ctrl/Cmd+K opens the game search; Ctrl/Cmd+1..6 switch pages (see `shortcuts.ts`).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        const ui = useUiStore.getState();
        ui.navigate("games");
        ui.setSearchOpen(true);
        return;
      }

      const page = pageForKeys(event);
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
