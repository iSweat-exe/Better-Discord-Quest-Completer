import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { CheckIcon, CircleAlertIcon, CopyIcon, InfoIcon, ScrollTextIcon, Trash2Icon, TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";
import { SwapIcon } from "@/components/ui/swap-icon";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { ipc } from "@/lib/ipc";
import { useFlash } from "@/lib/use-flash";
import type { LogLevel } from "@/types/domain";

import { useLogStore } from "./log-store";

type Filter = "all" | LogLevel;

const LEVEL_STYLES: Record<LogLevel, { icon: ReactNode; className: string }> = {
  info: { icon: <InfoIcon />, className: "text-accent-text" },
  warning: { icon: <TriangleAlertIcon />, className: "text-warning" },
  error: { icon: <CircleAlertIcon />, className: "text-danger" },
};

export default function LogsPage() {
  const { t, locale } = useT();
  const entries = useLogStore((state) => state.entries);
  const clearStore = useLogStore((state) => state.clear);
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, flashCopied] = useFlash();

  // Newest first.
  const visible = useMemo(
    () => entries.filter((entry) => filter === "all" || entry.level === filter).toReversed(),
    [entries, filter],
  );

  const copy = () => {
    const text = visible
      .toReversed()
      .map((entry) => `[${formatTime(entry.timestamp, locale)}] ${entry.level.toUpperCase()} ${entry.message}`)
      .join("\n");
    void navigator.clipboard.writeText(text).then(() => {
      toast.success(t("logs.copied"));
      flashCopied();
    });
  };

  const clear = () => {
    void ipc.clearLogs().then(clearStore);
  };

  return (
    <div className="flex h-full flex-col px-8 pb-6 pt-7">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("logs.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("logs.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          <Segmented<Filter>
            label={t("logs.title")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("logs.filter.all") },
              { value: "info", label: t("logs.filter.info") },
              { value: "warning", label: t("logs.filter.warning") },
              { value: "error", label: t("logs.filter.error") },
            ]}
          />
          <Button size="sm" disabled={visible.length === 0} onClick={copy}>
            <SwapIcon
              swapped={copied}
              from={<CopyIcon size={16} />}
              to={<CheckIcon size={16} />}
            />
            {t("logs.copy")}
          </Button>
          <Button size="sm" variant="danger" disabled={entries.length === 0} onClick={clear}>
            <Trash2Icon />
            {t("logs.clear")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-card bg-surface shadow-card" data-selectable>
        {visible.length === 0 ? (
          <EmptyState icon={<ScrollTextIcon />} title={entries.length === 0 ? t("logs.empty") : t("logs.emptyFiltered")} />
        ) : (
          <ol className="p-1.5">
            {visible.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[4.75rem_1rem_1fr] items-start gap-3 rounded-inner px-3 py-1.5 hover:bg-raised"
              >
                <time className="font-mono text-xs tabular-nums leading-5 text-subtle">
                  {formatTime(entry.timestamp, locale)}
                </time>
                <span className={cn("mt-0.5 [&_svg]:size-4", LEVEL_STYLES[entry.level].className)}>
                  {LEVEL_STYLES[entry.level].icon}
                  <span className="sr-only">{entry.level}</span>
                </span>
                <span className="min-w-0 break-words text-[13px] leading-5">{entry.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
