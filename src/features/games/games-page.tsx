import { SearchIcon } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { EmptyState, Kbd } from "@/components/ui/primitives";
import { SearchPalette } from "@/features/catalog/search-palette";
import { DiscordChip } from "@/features/discord/discord-chip";
import { useCatalog } from "@/features/catalog/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { sortLibrary } from "@/lib/library";
import { useT } from "@/lib/i18n/use-t";

import { GameDetail } from "./game-detail";
import { LibraryList } from "./library-list";
import { useLibrary } from "./queries";

function SearchTrigger() {
  const { t, locale } = useT();
  const { data: catalog } = useCatalog();
  const setSearchOpen = useUiStore((state) => state.setSearchOpen);

  const label = catalog
    ? t("games.searchPlaceholder", { count: new Intl.NumberFormat(locale).format(catalog.games.length) })
    : t("games.searchLoading");

  return (
    <button
      type="button"
      onClick={() => {
        setSearchOpen(true);
      }}
      className="flex h-11 w-full items-center gap-3 rounded-control bg-surface px-4 text-left text-muted shadow-card transition-[box-shadow,color] duration-150 ease-out hover:text-fg"
    >
      <SearchIcon size={18} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className="flex items-center gap-1" aria-hidden="true">
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </span>
    </button>
  );
}

function Welcome() {
  const { t } = useT();
  const setSearchOpen = useUiStore((state) => state.setSearchOpen);
  const steps = ["games.empty.step1", "games.empty.step2", "games.empty.step3"] as const;

  return (
    <div className="col-span-full grid place-items-center overflow-y-auto rounded-card bg-surface shadow-card">
      <div className="flex w-full max-w-md flex-col items-center py-8">
        <EmptyState
          title={t("games.empty.title")}
          action={
            <Button
              variant="primary"
              onClick={() => {
                setSearchOpen(true);
              }}
            >
              <SearchIcon />
              {t("games.empty.cta")}
            </Button>
          }
        >
          {t("games.empty.body")}
        </EmptyState>

        <ol className="mt-4 w-full max-w-sm list-decimal space-y-1.5 pl-5 text-sm text-muted marker:tabular-nums marker:text-subtle">
          {steps.map((step) => (
            <li key={step} className="pl-1">
              {t(step)}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

export function GamesPage() {
  const { t } = useT();
  const { data: entries = [], isPending } = useLibrary();
  const selectedGameId = useUiStore((state) => state.selectedGameId);
  const selectGame = useUiStore((state) => state.selectGame);

  // Derived, not stored: fall back to the first game when nothing valid is selected.
  const selected = entries.find((entry) => entry.game.id === selectedGameId) ?? sortLibrary(entries)[0];

  return (
    <div className="flex h-full flex-col">
      <header className="px-8 pb-5 pt-7">
        <h1 className="sr-only">{t("nav.games")}</h1>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <SearchTrigger />
          </div>
          <DiscordChip />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(264px,340px)_minmax(0,1fr)] gap-5 px-8 pb-6">
        {isPending ? null : selected ? (
          <>
            <LibraryList entries={entries} selectedId={selected.game.id} onSelect={selectGame} />
            <GameDetail key={selected.game.id} entry={selected} />
          </>
        ) : (
          <Welcome />
        )}
      </div>

      <SearchPalette />
    </div>
  );
}
