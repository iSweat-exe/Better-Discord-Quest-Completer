import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { CheckIcon, CopyIcon, RefreshCwIcon, TrophyIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "@/components/ui/disclosure-chevron";
import { EmptyState, Spinner } from "@/components/ui/primitives";
import { SwapIcon } from "@/components/ui/swap-icon";
import { Segmented } from "@/components/ui/segmented";
import { useCatalog } from "@/features/catalog/queries";
import { useLibrary } from "@/features/games/queries";
import { useSessionStore } from "@/features/sessions/session-store";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { IpcError } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import { isOpen, questState, resolveQuestGame, sortQuests } from "@/lib/quests";
import { useFlash } from "@/lib/use-flash";
import { useMinute } from "@/lib/use-now";

import { OrbsBalance } from "./orbs-balance";
import { QuestCard } from "./quest-card";
import { useDisconnectQuests, useQuests, useQuestsConnection } from "./queries";
import { TokenGate } from "./token-gate";

type Filter = "todo" | "done";

function QuestBoard() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  // Worded in days and hours: a clock per minute is enough, and spares the whole list a rebuild every second.
  const now = useMinute();

  const quests = useQuests();
  const disconnect = useDisconnectQuests();
  const { data: catalog } = useCatalog();
  const { data: library = [] } = useLibrary();
  const sessions = useSessionStore((state) => state.sessions);
  const [filter, setFilter] = useState<Filter>("todo");
  const [rawCopied, flashRawCopied] = useFlash();

  // A token Discord refuses is removed by the backend: go back to the gate.
  const tokenGone =
    quests.error instanceof IpcError && (quests.error.kind === "tokenInvalid" || quests.error.kind === "tokenMissing");
  useEffect(() => {
    if (tokenGone) void queryClient.invalidateQueries({ queryKey: queryKeys.questsConnection });
  }, [tokenGone, queryClient]);

  const libraryIds = useMemo(() => new Set(library.map((entry) => entry.game.id)), [library]);
  const runningIds = useMemo(() => new Set(sessions.map((session) => session.gameId)), [sessions]);

  const games = catalog?.games;

  const questList = quests.data?.quests;
  const sorted = useMemo(() => sortQuests(questList ?? [], now), [questList, now]);
  const visible = sorted.filter((quest) => isOpen(questState(quest, now)) === (filter === "todo"));

  // Resolved from the quests themselves, not from the clock: a tick must not search the catalog again.
  const resolvedGames = useMemo(
    () => new Map((questList ?? []).map((quest) => [quest.id, games ? resolveQuestGame(quest, games) : null])),
    [questList, games],
  );

  const copyRaw = () => {
    if (!quests.data) return;
    void navigator.clipboard.writeText(quests.data.rawJson).then(() => {
      toast.success(t("quests.rawCopied"));
      flashRawCopied();
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 pb-10 pt-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("quests.title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("quests.subtitle")}</p>
          </div>

          <div className="flex items-center gap-2">
            <OrbsBalance />
            <Button
              size="sm"
              disabled={quests.isFetching}
              onClick={() => {
                void quests.refetch();
                void queryClient.invalidateQueries({ queryKey: queryKeys.orbsBalance });
              }}
            >
              <RefreshCwIcon size={16} className={cn(quests.isFetching && "animate-spin")} />
              {t("quests.refresh")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={disconnect.isPending}
              onClick={() => {
                disconnect.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(t("quests.forgotten"));
                  },
                });
              }}
            >
              {t("quests.forget")}
            </Button>
          </div>
        </header>

        {quests.isPending ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner /> {t("common.loading")}
          </p>
        ) : quests.isError ? (
          <div className="rounded-card bg-surface shadow-card">
            <EmptyState
              icon={<TrophyIcon />}
              title={t("quests.loadFailed")}
              action={
                <Button
                  onClick={() => {
                    void quests.refetch();
                  }}
                >
                  {t("common.retry")}
                </Button>
              }
            >
              {errorMessage(quests.error, t)}
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented<Filter>
                label={t("quests.title")}
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "todo", label: t("quests.filter.todo") },
                  { value: "done", label: t("quests.filter.done") },
                ]}
              />
              <p className="text-xs text-subtle">
                {t("quests.updated", { when: formatRelativeTime(quests.data.fetchedAt, now, locale) })}
              </p>
            </div>

            {visible.length === 0 ? (
              <div className="rounded-card bg-surface shadow-card">
                <EmptyState icon={<TrophyIcon />} title={t(filter === "todo" ? "quests.empty.todo" : "quests.empty.done")} />
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {visible.map((quest) => {
                  const resolved = resolvedGames.get(quest.id) ?? null;
                  return (
                    <QuestCard
                      key={quest.id}
                      quest={quest}
                      now={now}
                      resolved={resolved}
                      inLibrary={resolved !== null && libraryIds.has(resolved.game.id)}
                      running={resolved !== null && runningIds.has(resolved.game.id)}
                    />
                  );
                })}
              </ul>
            )}

            <details className="group text-[13px] text-muted">
              <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 rounded-lg py-1 hover:text-fg">
                <DisclosureChevron />
                {t("quests.copyRaw")}
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={copyRaw}>
                  <SwapIcon
                    swapped={rawCopied}
                    from={<CopyIcon size={16} />}
                    to={<CheckIcon size={16} />}
                  />
                  {t("quests.copyRaw")}
                </Button>
                <p className="min-w-0 flex-1 text-xs text-subtle">{t("quests.copyRawHint")}</p>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

export default function QuestsPage() {
  const connection = useQuestsConnection();

  if (connection.isPending) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner className="size-5" />
      </div>
    );
  }
  return connection.data ? <QuestBoard /> : <TokenGate />;
}
