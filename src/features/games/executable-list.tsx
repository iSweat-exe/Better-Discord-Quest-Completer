import { ChevronRightIcon, FolderSearchIcon, PlayIcon, SquareIcon, TriangleAlertIcon } from "@/components/icons";
import { Fragment } from "react";

import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { groupExecutables, pathSegments } from "@/lib/executables";
import { formatClock } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { timerElapsedSeconds } from "@/lib/sessions";
import { useNow } from "@/lib/use-now";
import type { Executable, Game, SessionInfo } from "@/types/domain";

import { useRevealExecutable } from "./queries";

/** `bin › win64 › game.exe`, truncated on the left so the file name stays visible. */
function PathBreadcrumb({ name, muted = false }: { name: string; muted?: boolean }) {
  const segments = pathSegments(name);
  const file = segments.at(-1) ?? name;
  const folders = segments.slice(0, -1);

  return (
    <span
      dir="rtl"
      title={name}
      className={cn("block min-w-0 flex-1 truncate text-left font-mono text-[13px]", muted && "text-muted")}
    >
      <bdi dir="ltr">
        {folders.map((folder, index) => (
          <Fragment key={`${folder}-${index.toString()}`}>
            <span className="text-muted">{folder}</span>
            <ChevronRightIcon size={12} className="mx-0.5 inline align-[-1px] text-subtle" />
          </Fragment>
        ))}
        <span className={muted ? undefined : "font-medium text-fg"}>{file}</span>
      </bdi>
    </span>
  );
}

function ElapsedLabel({ session }: { session: SessionInfo }) {
  const { t } = useT();
  const now = useNow();
  const elapsed = timerElapsedSeconds(session, now);

  // Still waiting for Discord: there is no timer to show yet.
  if (elapsed === null) {
    return (
      <span className="shrink-0 text-[13px] font-medium text-warning" title={t("games.status.waiting")}>
        {t("games.status.waiting")}
      </span>
    );
  }

  return <span className="shrink-0 text-[13px] font-medium tabular-nums text-success">{formatClock(elapsed)}</span>;
}

interface ExecutableListProps {
  game: Game;
  sessions: SessionInfo[];
  /** Executable currently being started or stopped. */
  pendingExecutable: string | null;
  onPlay: (executable: Executable) => void;
  onStop: (session: SessionInfo) => void;
}

export function ExecutableList({ game, sessions, pendingExecutable, onPlay, onStop }: ExecutableListProps) {
  const { t } = useT();
  const groups = groupExecutables(game);
  const reveal = useRevealExecutable();

  return (
    <section aria-labelledby="executables-heading">
      <h3 id="executables-heading" className="text-sm font-semibold tracking-tight">
        {t("games.detail.executables")}
      </h3>
      <p className="mb-3 mt-0.5 text-[13px] text-muted">{t("games.detail.executablesHint")}</p>

      {groups.usable.length === 0 ? (
        <div className="flex items-start gap-3 rounded-inner bg-warning-soft p-4 text-sm text-warning">
          <TriangleAlertIcon size={18} className="mt-0.5 shrink-0" />
          <p>{t("games.detail.noWindows")}</p>
        </div>
      ) : (
        // Rows have a 10px radius and the list 6px of padding: 16px outside.
        <ul className="rounded-card bg-sunken p-1.5">
          {groups.usable.map((executable) => {
            const session = sessions.find((candidate) => candidate.executable === executable.name);
            const pending = pendingExecutable === executable.name;

            return (
              <li
                key={executable.name}
                className="flex items-center gap-3 rounded-inner px-3 py-2 transition-colors duration-150 hover:bg-surface"
              >
                <PathBreadcrumb name={executable.name} />
                {executable.isLauncher ? <Badge>{t("games.exe.launcher")}</Badge> : null}
                {session ? <ElapsedLabel session={session} /> : null}
                <Tooltip content={t("games.exe.reveal")}>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t("games.exe.reveal")}
                    onClick={() => {
                      reveal.mutate({ gameId: game.id, executable: executable.name });
                    }}
                  >
                    <FolderSearchIcon />
                  </Button>
                </Tooltip>
                {session ? (
                  <Button
                    variant="danger"
                    size="sm"
                    className="w-24"
                    disabled={pending}
                    onClick={() => {
                      onStop(session);
                    }}
                  >
                    <SquareIcon className="[&_svg]:fill-current" />
                    {t("games.exe.stop")}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-24"
                    disabled={pending}
                    onClick={() => {
                      onPlay(executable);
                    }}
                  >
                    <PlayIcon className="[&_svg]:fill-current" />
                    {t("games.exe.play")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {groups.unsupported.length > 0 ? (
        <details className="group mt-3 text-[13px] text-muted">
          <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-lg px-1 py-1 hover:text-fg">
            <DisclosureChevron />
            {t("games.detail.unsupported", { count: groups.unsupported.length })}
          </summary>
          <ul className="mt-1.5 space-y-1 px-1">
            {groups.unsupported.map((executable) => (
              <li key={executable.name} className="flex items-center gap-3">
                <PathBreadcrumb name={executable.name} muted />
                <Badge tone="warning">
                  {executable.support === "notExe"
                    ? t("games.exe.unsupported.notExe")
                    : t("games.exe.unsupported.invalidPath")}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
