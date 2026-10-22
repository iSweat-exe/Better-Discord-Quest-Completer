import { CircleStop, ShoppingBag } from "lucide-react";
import { Gamepad2Icon, RadioIcon, ScrollTextIcon, SettingsIcon, TrophyIcon } from "@/components/icons";
import type { ReactNode } from "react";

import { usePrefetchQuests } from "@/features/quests/queries";
import { useStopAllSessions } from "@/features/sessions/queries";
import { useSessionStore } from "@/features/sessions/session-store";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n";

import { UpdateCard } from "@/features/update/update-card";

import { modifierLabel, shortcutDigit } from "./shortcuts";
import { SidebarProfile } from "./sidebar-profile";
import { useUiStore, type Page } from "./ui-store";

const PRIMARY_PAGES: { page: Page; icon: ReactNode; label: MessageKey }[] = [
  { page: "games", icon: <Gamepad2Icon />, label: "nav.games" },
  { page: "quests", icon: <TrophyIcon />, label: "nav.quests" },
  { page: "shop", icon: <ShoppingBag />, label: "nav.shop" },
  { page: "presence", icon: <RadioIcon />, label: "nav.presence" },
  { page: "logs", icon: <ScrollTextIcon />, label: "nav.logs" },
];

function NavItem({ page, icon, label }: { page: Page; icon: ReactNode; label: MessageKey }) {
  const { t } = useT();
  const active = useUiStore((state) => state.page === page);
  const navigate = useUiStore((state) => state.navigate);
  const prefetchQuests = usePrefetchQuests();
  const prefetch = page === "quests" ? prefetchQuests : undefined;
  const digit = shortcutDigit(page);

  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onPointerEnter={prefetch}
      onFocus={prefetch}
      onClick={() => {
        navigate(page);
      }}
      className={cn(
        "group flex h-10 w-full items-center gap-3 rounded-control px-3 text-left text-sm font-medium [&_svg]:size-[18px]",
        "transition-[background-color,color,box-shadow] duration-150 ease-out [&_svg]:transition-colors [&_svg]:duration-150",
        active ? "bg-surface text-fg shadow-card [&_svg]:text-accent-text" : "text-muted hover:bg-raised hover:text-fg",
      )}
    >
      {icon}
      <span className="flex-1 truncate">{t(label)}</span>
      {digit !== null ? (
        // Shown when the entry is pointed at or focused: a hint, not a permanent label.
        <Kbd
          aria-hidden="true"
          className="bg-transparent text-subtle opacity-0 shadow-none transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          {modifierLabel()} {digit}
        </Kbd>
      ) : null}
    </button>
  );
}

/**
 * What is running, in one line that keeps its place whether or not a game runs.
 * Stopping everything is rare and a bit drastic, so it is an icon that turns red
 * when reached for, not a red button that is always shouting.
 */
function RunningSummary() {
  const { t } = useT();
  const count = useSessionStore((state) => state.sessions.length);
  const stopAll = useStopAllSessions();

  if (count === 0) {
    return <p className="flex h-8 items-center px-3 text-[13px] text-subtle">{t("nav.idle")}</p>;
  }

  return (
    <div className="flex h-8 items-center gap-2 pl-3 text-[13px] font-medium">
      <span className="size-2 shrink-0 animate-breathe rounded-full bg-success motion-reduce:animate-none" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{t("nav.running", { count })}</span>
      <Tooltip content={t("nav.stopAll")} side="right">
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={t("nav.stopAll")}
          disabled={stopAll.isPending}
          className="hover:bg-danger-soft hover:text-danger"
          onClick={() => {
            stopAll.mutate();
          }}
        >
          <CircleStop aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  );
}

export function Sidebar() {
  const { t } = useT();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col bg-sunken px-3 pb-3 pt-4 shadow-[1px_0_0_var(--line)]">
      <div className="mb-5 flex items-center gap-2.5 px-2">
        <img src="/logo.png" alt="" width={30} height={30} draggable={false} />
        <span className="text-[15px] font-semibold leading-tight tracking-tight">{t("app.name")}</span>
      </div>

      <nav aria-label="Pages" className="flex flex-col gap-0.5">
        {PRIMARY_PAGES.map((item) => (
          <NavItem key={item.page} {...item} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col">
        <UpdateCard />
        <RunningSummary />
        <NavItem page="settings" icon={<SettingsIcon />} label="nav.settings" />
        <SidebarProfile />
      </div>
    </aside>
  );
}
