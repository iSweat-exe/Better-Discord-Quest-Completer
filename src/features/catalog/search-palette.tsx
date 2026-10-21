import { useDeferredValue, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { CheckIcon, RefreshCwIcon, SearchIcon, SearchXIcon, TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/ui/game-icon";
import { Modal } from "@/components/ui/modal";
import { Badge, Kbd, Spinner } from "@/components/ui/primitives";
import { Tooltip } from "@/components/ui/tooltip";
import { useAddToLibrary, useLibrary } from "@/features/games/queries";
import { useStartSession } from "@/features/sessions/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import { firstPlayable, isPlayable } from "@/lib/executables";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { useNow } from "@/lib/use-now";
import { indexFor, searchGames } from "@/lib/search";
import type { Catalog, Game } from "@/types/domain";

import { useCatalog, useRefreshCatalog } from "./queries";

const LISTBOX_ID = "game-search-results";
const optionId = (game: Game) => `game-option-${game.id}`;

function CatalogStatus({ catalog }: { catalog: Catalog }) {
  const { t, locale } = useT();
  const refresh = useRefreshCatalog();
  const now = useNow();

  const source =
    catalog.source === "discord"
      ? t("search.source.discord")
      : catalog.source === "cache" && catalog.fetchedAt !== null
        ? t("search.source.cache", { when: formatRelativeTime(catalog.fetchedAt, now, locale) })
        : t("search.source.bundled");

  return (
    <div className="flex items-center gap-1.5 text-xs text-subtle">
      {catalog.refreshError ? (
        <Tooltip content={t("search.refreshFailed")}>
          {/* A span takes the tooltip's ref: the icon itself does not forward one. */}
          <span className="inline-flex" tabIndex={0} aria-label={t("search.refreshFailed")}>
            <TriangleAlertIcon size={14} className="text-warning" />
          </span>
        </Tooltip>
      ) : null}
      <span className="truncate">{source}</span>
      <Tooltip content={t("common.refresh")}>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={t("common.refresh")}
          disabled={refresh.isPending}
          onClick={() => {
            refresh.mutate();
          }}
        >
          <RefreshCwIcon size={14} className={cn(refresh.isPending && "animate-spin")} />
        </Button>
      </Tooltip>
    </div>
  );
}

interface ResultRowProps {
  game: Game;
  active: boolean;
  inLibrary: boolean;
  onHover: () => void;
  onChoose: () => void;
}

function ResultRow({ game, active, inLibrary, onHover, onChoose }: ResultRowProps) {
  const { t } = useT();
  const playable = isPlayable(game);
  const hint = game.aliases[0] ?? game.executables.find((executable) => executable.support === "ok")?.name;

  return (
    <li
      id={optionId(game)}
      role="option"
      aria-selected={active}
      aria-disabled={!playable}
      // Chromium fires synthetic mouse moves (zero movement) when the list
      // re-renders under a still cursor: only a real move may steal the selection.
      onMouseMove={(event) => {
        if (event.movementX !== 0 || event.movementY !== 0) onHover();
      }}
      onClick={onChoose}
      className={cn(
        "flex cursor-default items-center gap-3 rounded-inner px-3 py-2",
        "transition-colors duration-100",
        active ? "bg-accent-soft" : "bg-transparent",
        !playable && "opacity-60",
      )}
    >
      <GameIcon gameId={game.id} name={game.name} iconHash={game.iconHash} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{game.name}</span>
        {hint ? <span className="block truncate font-mono text-xs text-muted">{hint}</span> : null}
      </span>
      {inLibrary ? (
        <Badge tone="success">
          <CheckIcon className="[&_svg]:stroke-2" />
          {t("search.inLibrary")}
        </Badge>
      ) : playable ? (
        <span
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium",
            active ? "bg-accent text-on-accent" : "text-muted",
          )}
        >
          {t("common.add")}
        </span>
      ) : (
        <Badge tone="warning">{t("search.notPlayable")}</Badge>
      )}
    </li>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { t, locale } = useT();
  const catalog = useCatalog();
  const library = useLibrary();
  const add = useAddToLibrary();
  const start = useStartSession();
  const selectGame = useUiStore((state) => state.selectGame);

  const seed = useUiStore((state) => state.searchSeed);
  const [query, setQuery] = useState(seed);
  const [activeIndex, setActiveIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);

  const index = useMemo(
    () => (catalog.data ? indexFor(catalog.data.games) : null),
    [catalog.data],
  );
  const results = useMemo(
    () => (index ? searchGames(index, deferredQuery) : []),
    [index, deferredQuery],
  );
  const libraryIds = useMemo(
    () => new Set(library.data?.map((entry) => entry.game.id)),
    [library.data],
  );

  const activeGame = results[activeIndex];

  // Keep the keyboard selection visible while navigating long lists.
  useEffect(() => {
    if (activeGame) {
      document.getElementById(optionId(activeGame))?.scrollIntoView({ block: "nearest" });
    }
  }, [activeGame]);

  const launch = (game: Game) => {
    const executable = firstPlayable(game);
    if (executable) start.mutate({ gameId: game.id, executable: executable.name });
  };

  /** Adds the game (if needed), selects it and optionally launches it right away. */
  const choose = (game: Game, andLaunch: boolean) => {
    if (libraryIds.has(game.id)) {
      selectGame(game.id);
      if (andLaunch) launch(game);
      onClose();
      return;
    }
    if (!isPlayable(game)) return;

    add.mutate(game.id, {
      onSuccess: () => {
        selectGame(game.id);
        toast.success(t("games.addedToast", { name: game.name }));
        if (andLaunch) launch(game);
        onClose();
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % results.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + results.length) % results.length);
        break;
      case "Enter":
        event.preventDefault();
        if (activeGame) choose(activeGame, event.shiftKey);
        break;
    }
  };

  const typed = deferredQuery.trim().length >= 2;

  return (
    <>
      <div className="flex items-center gap-3 px-5 py-3.5 shadow-[0_1px_0_var(--line)]">
        <SearchIcon size={20} className="shrink-0 text-muted" />
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={activeGame ? optionId(activeGame) : undefined}
          aria-label={t("search.title")}
          placeholder={t("search.placeholder")}
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-subtle"
        />
        <Kbd>Esc</Kbd>
      </div>

      <div className="min-h-[216px]">
        {catalog.isPending ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner /> {t("common.loading")}
          </p>
        ) : catalog.isError ? (
          <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted">
            <p>{t("games.searchLoading")}</p>
            <Button
              size="sm"
              onClick={() => {
                void catalog.refetch();
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : results.length > 0 ? (
          <ul
            id={LISTBOX_ID}
            role="listbox"
            aria-label={t("search.title")}
            className="max-h-[min(46vh,400px)] space-y-0.5 overflow-y-auto p-1.5"
          >
            {results.map((game, position) => (
              <ResultRow
                key={game.id}
                game={game}
                active={position === activeIndex}
                inLibrary={libraryIds.has(game.id)}
                onHover={() => {
                  setActiveIndex(position);
                }}
                onChoose={() => {
                  choose(game, false);
                }}
              />
            ))}
          </ul>
        ) : typed ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <SearchXIcon size={28} className="mb-3 text-subtle" />
            <p className="font-medium">{t("search.empty", { query: deferredQuery.trim() })}</p>
            <p className="mt-1 text-sm text-muted">{t("search.emptyHelp")}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <SearchIcon size={28} className="mb-3 text-subtle" />
            <p className="text-sm text-muted">{t("search.hint")}</p>
            <p className="mt-1 text-xs tabular-nums text-subtle">
              {t("settings.gameListCount", {
                count: new Intl.NumberFormat(locale).format(catalog.data.games.length),
              })}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 px-5 py-2.5 shadow-[0_-1px_0_var(--line)]">
        <span className="text-xs text-subtle">{t("search.keysLaunch")}</span>
        {catalog.data ? <CatalogStatus catalog={catalog.data} /> : null}
      </div>
    </>
  );
}

/** Command-palette style search over the whole Discord catalog. */
export function SearchPalette() {
  const { t } = useT();
  const open = useUiStore((state) => state.searchOpen);
  const setOpen = useUiStore((state) => state.setSearchOpen);

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("search.title")}
      hideTitle
      placement="top"
      className="w-[min(92vw,640px)] overflow-hidden"
    >
      <PaletteBody
        onClose={() => {
          setOpen(false);
        }}
      />
    </Modal>
  );
}
