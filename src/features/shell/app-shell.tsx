import { Activity, lazy, Suspense, useEffect, type ReactNode } from "react";

import { GamesPage } from "@/features/games/games-page";
import { UpdateDialog } from "@/features/update/update-dialog";
import { Spinner } from "@/components/ui/primitives";
import { whenIdle } from "@/lib/idle";

import { CloseDialog } from "./close-dialog";
import { Sidebar } from "./sidebar";
import { useUiStore, type Page } from "./ui-store";

// Secondary pages are rarely opened: keep them out of the initial bundle...
const loaders = {
  quests: () => import("@/features/quests/quests-page"),
  presence: () => import("@/features/presence/presence-page"),
  logs: () => import("@/features/logs/logs-page"),
  settings: () => import("@/features/settings/settings-page"),
  profile: () => import("@/features/profile/profile-page"),
};

const QuestsPage = lazy(loaders.quests);
const PresencePage = lazy(loaders.presence);
const LogsPage = lazy(loaders.logs);
const SettingsPage = lazy(loaders.settings);
const ProfilePage = lazy(loaders.profile);

const PAGES: readonly { page: Page; view: ReactNode }[] = [
  { page: "games", view: <GamesPage /> },
  { page: "quests", view: <QuestsPage /> },
  { page: "presence", view: <PresencePage /> },
  { page: "logs", view: <LogsPage /> },
  { page: "settings", view: <SettingsPage /> },
  { page: "profile", view: <ProfilePage /> },
];

const fallback = (
  <div className="grid h-full place-items-center text-muted">
    <Spinner className="size-5" />
  </div>
);

export function AppShell() {
  const current = useUiStore((state) => state.page);

  // ...but fetch them as soon as the app is idle, so no page change waits for its code.
  useEffect(
    () =>
      whenIdle(() => {
        Object.values(loaders).forEach((load) => {
          void load();
        });
      }),
    [],
  );

  return (
    <div className="flex h-full">
      <Sidebar />
      {/*
        Every page stays mounted and only the current one is visible: a page change
        is a display toggle, not a rebuild, and a page keeps its filters and form
        state. Hidden pages render at low priority and run no effects, so they
        fetch nothing and tick no timer until they are shown.
      */}
      <main className="min-w-0 flex-1 overflow-hidden">
        {PAGES.map(({ page, view }) => (
          <Activity key={page} mode={page === current ? "visible" : "hidden"}>
            {/* Shown again, the page fades in: opacity only, so it never feels slower. */}
            <div className="h-full animate-page-in">
              <Suspense fallback={fallback}>{view}</Suspense>
            </div>
          </Activity>
        ))}
      </main>
      <CloseDialog />
      <UpdateDialog />
    </div>
  );
}
