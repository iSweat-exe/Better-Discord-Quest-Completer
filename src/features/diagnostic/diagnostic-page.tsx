import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { CheckIcon, CircleAlertIcon, CircleCheckIcon, CopyIcon, InfoIcon, RefreshCwIcon, TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/primitives";
import { SwapIcon } from "@/components/ui/swap-icon";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatRelativeTime } from "@/lib/format";
import type { MessageKey, Translate } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query";
import { useFlash } from "@/lib/use-flash";
import { useMinute } from "@/lib/use-now";
import type { CheckStatus, DiagnosticCheck } from "@/types/domain";

const STATUS_ICONS: Record<CheckStatus, ReactNode> = {
  ok: <CircleCheckIcon className="text-success" />,
  warning: <TriangleAlertIcon className="text-warning" />,
  error: <CircleAlertIcon className="text-danger" />,
  info: <InfoIcon className="text-muted" />,
};

/** Plain-text markers for the copied report, which has no icons. */
const STATUS_MARKS: Record<CheckStatus, string> = { ok: "[OK]", warning: "[!]", error: "[X]", info: "[i]" };

/** The message key that explains a check: its status, refined where one status covers several cases. */
function explanationKey(check: DiagnosticCheck): MessageKey {
  switch (check.id) {
    case "runner":
      if (check.status !== "error") return "diag.runner.ok";
      if (check.detail === null) return "diag.runner.missing";
      if (check.detail === "removed") return "diag.runner.removed";
      if (check.detail === "altered") return "diag.runner.altered";
      return "diag.runner.error";
    case "discordLog":
      if (check.status === "warning") return check.at === null ? "diag.discordLog.missing" : "diag.discordLog.stale";
      return check.status === "error" ? "diag.discordLog.error" : "diag.discordLog.ok";
    case "primaryGame":
      return check.detail === null ? "diag.primaryGame.none" : "diag.primaryGame.info";
    case "catalog":
      if (check.status === "ok") return "diag.catalog.ok";
      if (check.detail === null) return "diag.catalog.missing";
      return check.at === null ? "diag.catalog.bundled" : "diag.catalog.stale";
    default:
      return `diag.${check.id}.${check.status}` as MessageKey;
  }
}

function explain(check: DiagnosticCheck, t: Translate, now: number, locale: string): string {
  return t(explanationKey(check), {
    detail: check.detail ?? "",
    when: check.at === null ? "" : formatRelativeTime(check.at, now, locale),
  });
}

/** The checks as text, ready to paste in an issue (paths are already redacted by the backend). */
function report(checks: DiagnosticCheck[], t: Translate, now: number, locale: string): string {
  const lines = checks.map((check) => `${STATUS_MARKS[check.status]} ${t(`diag.${check.id}.title`)} — ${explain(check, t, now, locale)}`);
  return [`Discord Quest Completer — ${t("diag.title")} (${new Date(now).toISOString()})`, "", ...lines].join("\n");
}

/** Checks everything game detection depends on, in one click, with a report to copy. */
export default function DiagnosticPage() {
  const { t, locale } = useT();
  const diagnostics = useQuery({ queryKey: queryKeys.diagnostics, queryFn: ipc.runDiagnostics, staleTime: Infinity });
  const [copied, flashCopied] = useFlash();
  // Worded in minutes ("written 3 minutes ago"): a clock per minute is enough.
  const now = useMinute();

  const problems = diagnostics.data?.filter((check) => check.status === "error" || check.status === "warning").length ?? 0;

  const copy = () => {
    if (!diagnostics.data) return;
    navigator.clipboard
      .writeText(report(diagnostics.data, t, now, locale))
      .then(() => {
        toast.success(t("diag.copied"));
        flashCopied();
      })
      .catch(() => toast.error(t("diag.copyFailed")));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 pb-10 pt-7">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("diag.title")}</h1>
            <p className="mt-1 text-sm text-muted">{t("diag.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!diagnostics.data} onClick={copy}>
              <SwapIcon swapped={copied} from={<CopyIcon size={16} />} to={<CheckIcon size={16} />} />
              {t("diag.copy")}
            </Button>
            <Button size="sm" disabled={diagnostics.isFetching} onClick={() => void diagnostics.refetch()}>
              <RefreshCwIcon size={16} className={cn(diagnostics.isFetching && "animate-spin")} />
              {t("diag.rerun")}
            </Button>
          </div>
        </header>

        {diagnostics.isPending ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
            <Spinner /> {t("diag.running")}
          </p>
        ) : diagnostics.isError ? (
          <p className="rounded-card bg-danger-soft px-4 py-3 text-sm text-danger">{errorMessage(diagnostics.error, t)}</p>
        ) : (
          <>
            <p
              role="status"
              className={cn(
                "rounded-card px-4 py-3 text-sm font-medium",
                problems === 0 ? "bg-success-soft text-success" : "bg-warning-soft text-warning",
              )}
            >
              {problems === 0 ? t("diag.allGood") : t("diag.problems", { count: problems })}
            </p>
            <ul className="divide-y divide-line overflow-hidden rounded-card bg-surface shadow-card">
              {diagnostics.data.map((check) => (
                <li key={check.id} className="flex items-start gap-3 px-5 py-3.5 [&_svg]:size-[18px] [&_svg]:shrink-0">
                  <span className="mt-0.5" aria-hidden="true">
                    {STATUS_ICONS[check.status]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {t(`diag.${check.id}.title`)}
                      <span className="sr-only"> ({t(`diag.status.${check.status}`)})</span>
                    </p>
                    <p className="mt-0.5 break-words text-[13px] text-muted">{explain(check, t, now, locale)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
