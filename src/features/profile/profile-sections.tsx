import { Badge } from "@/components/ui/primitives";
import { useQuestActivity } from "@/features/quests/queries";
import { cn } from "@/lib/cn";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import type { MessageKey } from "@/lib/i18n";
import type { WeekStats } from "@/types/domain";

/** The Orbs the app earned, week by week (weeks start on Monday, UTC). */
export function WeeklyOrbs({ weeks }: { weeks: WeekStats[] }) {
  const { t, locale } = useT();
  const max = Math.max(1, ...weeks.map((week) => week.orbs));
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="rounded-card bg-surface p-4 shadow-card">
      <ol className="flex h-32 items-end gap-2" aria-label={t("profile.weekly.title")}>
        {weeks.map((week) => {
          const label = t("profile.weekly.bar", {
            week: dayMonth.format(week.weekStart),
            orbs: formatNumber(week.orbs, locale),
            count: week.quests,
          });
          return (
            <li key={week.weekStart} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={label}>
              <span className="text-[11px] tabular-nums text-muted">{week.orbs > 0 ? formatNumber(week.orbs, locale) : ""}</span>
              <div
                role="img"
                aria-label={label}
                className={cn("w-full rounded-t-md", week.orbs > 0 ? "bg-accent-text" : "bg-sunken")}
                style={{ height: `${Math.max(week.orbs > 0 ? 8 : 3, Math.round((week.orbs / max) * 80)).toString()}%` }}
              />
            </li>
          );
        })}
      </ol>
      <ol className="mt-2 flex gap-2" aria-hidden="true">
        {weeks.map((week) => (
          <li key={week.weekStart} className="min-w-0 flex-1 truncate text-center text-[11px] text-subtle">
            {dayMonth.format(week.weekStart)}
          </li>
        ))}
      </ol>
    </div>
  );
}

const KIND_LABELS = {
  enroll: "profile.history.enroll",
  claim: "profile.history.claim",
  video: "profile.history.video",
} as const satisfies Record<string, MessageKey>;

/** What the app wrote on the account, newest first: it is what makes the ban-risk level rise. */
export function ActivityHistory({ now }: { now: number }) {
  const { t, locale } = useT();
  const { data = [] } = useQuestActivity();

  if (data.length === 0) {
    return <p className="rounded-card bg-surface px-4 py-5 text-sm text-muted shadow-card">{t("profile.history.empty")}</p>;
  }

  return (
    <div>
      <p className="px-1 pb-2 text-xs text-subtle">{t("profile.history.hint")}</p>
      <ol className="max-h-80 overflow-y-auto rounded-card bg-surface p-1.5 shadow-card">
        {data.map((entry) => (
          <li
            key={`${entry.at.toString()}-${entry.kind}-${entry.questName}`}
            className={cn(
              "flex items-center justify-between gap-4 rounded-inner px-3.5 py-2.5 [&:not(:last-child)]:mb-px",
              !entry.counted && "opacity-60",
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{entry.questName}</span>
              <span className="block text-[13px] text-muted">
                {t(KIND_LABELS[entry.kind])} · {formatRelativeTime(entry.at, now, locale)}
              </span>
            </span>
            <Badge tone={entry.counted ? "danger" : "neutral"} title={t(entry.counted ? "profile.history.counted" : "profile.history.expired")}>
              +{entry.weight}
            </Badge>
          </li>
        ))}
      </ol>
    </div>
  );
}
