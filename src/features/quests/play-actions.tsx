import { toast } from "sonner";

import { PlayIcon, PlusIcon, SearchIcon, TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { GameIcon } from "@/components/ui/game-icon";
import { Badge } from "@/components/ui/primitives";
import { useAddToLibrary } from "@/features/games/queries";
import { useStartSession } from "@/features/sessions/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { cn } from "@/lib/cn";
import { firstPlayable } from "@/lib/executables";
import { useT } from "@/lib/i18n/use-t";
import { playTask, taskMinutes, type QuestGame } from "@/lib/quests";
import type { Quest } from "@/types/domain";

interface PlayActionsProps {
  quest: Quest;
  resolved: QuestGame | null;
  inLibrary: boolean;
  running: boolean;
}

/** Chooses among the games a quest accepts. */
export function GamePicker({
  games,
  selectedId,
  onSelect,
}: {
  games: QuestGame[];
  selectedId: string;
  onSelect: (gameId: string) => void;
}) {
  const { t } = useT();

  return (
    <div className="mt-3">
      <p className="text-xs text-subtle">{t("quests.pickGame", { count: games.length })}</p>
      <div role="radiogroup" aria-label={t("quests.pickGame", { count: games.length })} className="mt-1.5 flex flex-wrap gap-1.5">
        {games.map(({ game }) => (
          <button
            key={game.id}
            type="button"
            role="radio"
            aria-checked={game.id === selectedId}
            aria-label={game.name}
            title={game.name}
            onClick={() => {
              onSelect(game.id);
            }}
            className={cn(
              "hit-40 rounded-[26%] p-0.5 outline-offset-2 transition-opacity",
              game.id === selectedId ? "ring-2 ring-accent-text" : "opacity-60 hover:opacity-100",
            )}
          >
            <GameIcon gameId={game.id} name={game.name} iconHash={game.iconHash} size={32} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** What to do about a quest that asks to play a game. */
export function PlayActions({ quest, resolved, inLibrary, running }: PlayActionsProps) {
  const { t } = useT();
  const add = useAddToLibrary();
  const start = useStartSession();
  const openSearch = useUiStore((state) => state.openSearch);

  const task = playTask(quest);
  if (!task) return null;
  const minutes = taskMinutes(task);

  if (!resolved) {
    return (
      <Button
        size="sm"
        onClick={() => {
          openSearch(quest.gameTitle ?? quest.name);
        }}
      >
        <SearchIcon />
        {t("quests.search", { name: quest.gameTitle ?? quest.name })}
      </Button>
    );
  }

  const { game } = resolved;
  const executable = firstPlayable(game);
  if (!executable) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-warning">
        <TriangleAlertIcon size={16} className="shrink-0" />
        {t("quests.noWindows")}
      </div>
    );
  }

  if (running) return <Badge tone="success">{t("quests.running")}</Badge>;

  const launch = () => {
    start.mutate({ gameId: game.id, executable: executable.name, targetMinutes: minutes });
  };

  if (inLibrary) {
    return (
      <Button variant="primary" size="sm" disabled={start.isPending} onClick={launch}>
        <PlayIcon className="[&_svg]:fill-current" />
        {t("quests.launch", { minutes })}
      </Button>
    );
  }

  const addToLibrary = (thenLaunch: boolean) => {
    add.mutate(game.id, {
      onSuccess: () => {
        toast.success(t("games.addedToast", { name: game.name }));
        if (thenLaunch) launch();
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={add.isPending}
        onClick={() => {
          addToLibrary(false);
        }}
      >
        <PlusIcon />
        {t("quests.add")}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={add.isPending}
        onClick={() => {
          addToLibrary(true);
        }}
      >
        <PlayIcon className="[&_svg]:fill-current" />
        {t("quests.addAndLaunch")}
      </Button>
    </div>
  );
}
