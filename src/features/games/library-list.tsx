import { PlayIcon, SearchIcon, SquareIcon } from "@/components/icons";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/ui/game-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { useLaunchAll, useStartSession, useStopSession } from "@/features/sessions/queries";
import { useSessionStore } from "@/features/sessions/session-store";
import { cn } from "@/lib/cn";
import { firstPlayable } from "@/lib/executables";
import { formatClock } from "@/lib/format";
import { launchableGames, matchesFilter, sortLibrary } from "@/lib/library";
import { useT } from "@/lib/i18n/use-t";
import { useNow } from "@/lib/use-now";
import { timerElapsedSeconds } from "@/lib/sessions";
import type { LibraryEntry, SessionInfo } from "@/types/domain";

/** The filter box only earns its place once the list is long enough to need it. */
const FILTER_THRESHOLD = 6;

function RunningLabel({ session }: { session: SessionInfo }) {
  const { t } = useT();
  const now = useNow();
  const elapsed = timerElapsedSeconds(session, now);

  // The timer has not started: Discord has not noticed the game yet.
  if (elapsed === null) {
    return (
      <span className="flex items-center gap-1.5 text-warning">
        <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />
        {t("games.status.waiting")}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-success">
      <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
      {t("games.status.running")}
      <span className="tabular-nums">{formatClock(elapsed)}</span>
    </span>
  );
}

interface LibraryRowProps {
  entry: LibraryEntry;
  selected: boolean;
  onSelect: () => void;
}

function LibraryRow({ entry, selected, onSelect }: LibraryRowProps) {
  const { t } = useT();
  const { game } = entry;
  const start = useStartSession();
  const stop = useStopSession();

  const runningSession = useSessionStore((state) => state.sessions.find((session) => session.gameId === game.id));
  const executable = firstPlayable(game);
  const running = runningSession !== undefined;

  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-inner p-2.5 pr-12 text-left",
          "transition-[background-color,box-shadow] duration-150 ease-out",
          selected ? "bg-accent-soft shadow-[inset_0_0_0_1px_oklch(0.65_0.17_277/0.4)]" : "hover:bg-raised",
        )}
      >
        <GameIcon gameId={game.id} name={game.name} iconHash={game.iconHash} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{game.name}</span>
          <span className="block truncate text-[13px] text-muted">
            {runningSession ? (
              <RunningLabel session={runningSession} />
            ) : executable ? (
              <span className="font-mono text-xs">{executable.name}</span>
            ) : (
              <span className="text-warning">{t("search.notPlayable")}</span>
            )}
          </span>
        </span>
      </button>

      {/* Quick action, reachable by keyboard; it fades in on hover or focus. */}
      {executable || runningSession ? (
        <Tooltip content={running ? t("games.row.stop", { name: game.name }) : t("games.row.play", { name: game.name })}>
          <Button
            variant={running ? "danger" : "ghost"}
            size="iconSm"
            aria-label={running ? t("games.row.stop", { name: game.name }) : t("games.row.play", { name: game.name })}
            disabled={start.isPending || stop.isPending}
            onClick={() => {
              if (runningSession) stop.mutate(runningSession.id);
              else if (executable) start.mutate({ gameId: game.id, executable: executable.name });
            }}
            className={cn(
              "absolute right-2.5 top-1/2 -translate-y-1/2",
              !running && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
            )}
          >
            {running ? <SquareIcon className="[&_svg]:fill-current" /> : <PlayIcon className="[&_svg]:fill-current" />}
          </Button>
        </Tooltip>
      ) : null}
    </li>
  );
}

interface LibraryListProps {
  entries: LibraryEntry[];
  selectedId: string | null;
  onSelect: (gameId: string) => void;
}

export function LibraryList({ entries, selectedId, onSelect }: LibraryListProps) {
  const { t } = useT();
  const sessions = useSessionStore((state) => state.sessions);
  const launchAll = useLaunchAll();
  const [filter, setFilter] = useState("");

  const visible = useMemo(
    () => sortLibrary(entries).filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );
  const toLaunch = useMemo(() => launchableGames(entries, sessions), [entries, sessions]);

  return (
    <section aria-labelledby="library-heading" className="flex min-h-0 flex-col rounded-card bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-3.5">
        <div className="flex items-baseline gap-2">
          <h2 id="library-heading" className="text-xs font-semibold uppercase tracking-wider text-subtle">
            {t("games.libraryTitle")}
          </h2>
          <span className="text-xs tabular-nums text-subtle">
            {t("games.libraryCount", { count: entries.length })}
          </span>
        </div>

        {entries.length > 1 ? (
          <Tooltip content={t("games.launchAllHint")}>
            <Button
              variant="ghost"
              size="sm"
              disabled={toLaunch.length === 0 || launchAll.isPending}
              onClick={() => {
                launchAll.mutate(
                  toLaunch.flatMap((entry) => {
                    const executable = firstPlayable(entry.game);
                    return executable ? [{ gameId: entry.game.id, executable: executable.name }] : [];
                  }),
                );
              }}
            >
              <PlayIcon className="[&_svg]:fill-current" />
              {t("games.launchAll")}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      {entries.length >= FILTER_THRESHOLD ? (
        <div className="relative mx-3.5 mb-1.5">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            value={filter}
            placeholder={t("games.filterPlaceholder")}
            aria-label={t("games.filterPlaceholder")}
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            className="h-9 w-full rounded-lg bg-sunken pl-9 pr-3 text-sm outline-none placeholder:text-subtle focus-visible:shadow-[0_0_0_2px_var(--accent-text)]"
          />
        </div>
      ) : null}

      {/* 6px of padding around 10px-radius rows matches the card's 16px. */}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5 pt-0.5">
        {visible.map((entry) => (
          <LibraryRow
            key={entry.game.id}
            entry={entry}
            selected={entry.game.id === selectedId}
            onSelect={() => {
              onSelect(entry.game.id);
            }}
          />
        ))}
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-muted">{t("games.filterEmpty")}</li>
        ) : null}
      </ul>
    </section>
  );
}
