import { useMemo } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/primitives";
import { CheckIcon, CopyIcon, Trash2Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SwapIcon } from "@/components/ui/swap-icon";
import { GameIcon } from "@/components/ui/game-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { useSessionStore } from "@/features/sessions/session-store";
import { useStartSession, useStopSession } from "@/features/sessions/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { useFlash } from "@/lib/use-flash";
import { useNow } from "@/lib/use-now";
import type { LibraryEntry } from "@/types/domain";

import { DetectionPanel } from "./detection-panel";
import { ExecutableList } from "./executable-list";
import { QuestTimer } from "./quest-timer";
import { useRemoveFromLibrary } from "./queries";
import { useGameHue } from "./use-game-hue";

function PlaytimeLine({ entry }: { entry: LibraryEntry }) {
  const { t, locale } = useT();
  const now = useNow();

  const parts =
    entry.lastPlayedAt === null
      ? [t("games.detail.neverPlayed")]
      : [
          t("games.detail.playtime", { time: formatDuration(entry.totalSeconds) }),
          t("games.detail.lastPlayed", { when: formatRelativeTime(entry.lastPlayedAt, now, locale) }),
        ];

  return <p className="mt-1.5 text-[13px] text-muted">{parts.join(" · ")}</p>;
}

export function GameDetail({ entry }: { entry: LibraryEntry }) {
  const { t } = useT();
  const { game } = entry;
  const hue = useGameHue(game.id, game.iconHash);

  const allSessions = useSessionStore((state) => state.sessions);
  const sessions = useMemo(
    () => allSessions.filter((session) => session.gameId === game.id),
    [allSessions, game.id],
  );
  const running = sessions.length > 0;

  const start = useStartSession();
  const stop = useStopSession();
  const remove = useRemoveFromLibrary();
  const selectGame = useUiStore((state) => state.selectGame);

  const pendingExecutable = start.isPending ? start.variables.executable : null;
  const timerSession = sessions[0];

  const [idCopied, flashIdCopied] = useFlash();

  const copyId = () => {
    void navigator.clipboard.writeText(game.id).then(() => {
      toast.success(t("common.copied"));
      flashIdCopied();
    });
  };

  return (
    <article
      aria-label={game.name}
      className="flex min-h-0 flex-col overflow-y-auto rounded-card bg-surface shadow-card"
    >
      <header className="flex items-start gap-4 p-6 pb-5">
        <GameIcon gameId={game.id} name={game.name} iconHash={game.iconHash} size={64} />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold tracking-tight">{game.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Tooltip content={t("games.detail.copyId")}>
              <button
                type="button"
                onClick={copyId}
                className="hit-40 group inline-flex items-center gap-1.5 rounded-md font-mono text-xs text-muted transition-colors duration-150 hover:text-fg"
              >
                <span data-selectable>{game.id}</span>
                <SwapIcon
                  swapped={idCopied}
                  from={<CopyIcon size={12} />}
                  to={<CheckIcon size={12} />}
                  className="size-3 opacity-60 transition-opacity group-hover:opacity-100"
                />
              </button>
            </Tooltip>
            {game.themes.slice(0, 3).map((theme) => (
              <Badge key={theme}>{theme}</Badge>
            ))}
          </div>
          <PlaytimeLine entry={entry} />
        </div>

        <Tooltip content={running ? t("games.removeBlocked") : t("games.remove")}>
          {/* A span keeps the tooltip working while the button is disabled. */}
          <span className="inline-flex">
            <Button
              variant="danger"
              size="iconSm"
              aria-label={t("games.remove")}
              disabled={running || remove.isPending}
              onClick={() => {
                remove.mutate(game.id, {
                  onSuccess: () => {
                    selectGame(null);
                  },
                });
              }}
            >
              <Trash2Icon />
            </Button>
          </span>
        </Tooltip>
      </header>

      <div className="flex flex-col gap-6 px-6 pb-6">
        {timerSession ? <QuestTimer session={timerSession} hue={hue} /> : null}
        {timerSession ? <DetectionPanel key={timerSession.id} session={timerSession} /> : null}

        <ExecutableList
          game={game}
          sessions={sessions}
          pendingExecutable={pendingExecutable}
          onPlay={(executable) => {
            start.mutate({ gameId: game.id, executable: executable.name });
          }}
          onStop={(session) => {
            stop.mutate(session.id);
          }}
        />
      </div>
    </article>
  );
}
