import { openUrl } from "@tauri-apps/plugin-opener";
import { ClockIcon, Gamepad2Icon, TrophyIcon, UserRoundIcon } from "@/components/icons";
import { useMemo, type ReactNode } from "react";

import { EmptyState, Spinner } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { OrbIcon } from "@/components/ui/orb-icon";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useLibrary } from "@/features/games/queries";
import { useOrbsBalance, useProfile, useQuests, useQuestsConnection } from "@/features/quests/queries";
import { useUiStore } from "@/features/shell/ui-store";
import { formatDuration, formatNumber, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { AUTHOR_HANDLE, AUTHOR_URL } from "@/lib/links";
import { questStats } from "@/lib/stats";
import { useNow } from "@/lib/use-now";

import { ActivityHistory, WeeklyOrbs } from "./profile-sections";
import { useAppStats } from "./queries";

/** Shown while a figure is not known (loading, or Discord did not answer). */
const UNKNOWN = "–";

interface StatProps {
  label: string;
  value: string;
  hint?: string | undefined;
  icon?: ReactNode;
}

function Stat({ label, value, hint, icon }: StatProps) {
  return (
    <div className="rounded-card bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-[13px] text-muted [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-snug text-subtle">{hint}</p> : null}
    </div>
  );
}

/** A titled block of stats; each block enters a little after the previous one. */
function Group({ title, delay, children }: { title: string; delay: number; children: ReactNode }) {
  return (
    <section className="animate-fade-up" style={{ animationDelay: `${(delay * 60).toString()}ms` }}>
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h2>
      {children}
    </section>
  );
}

function Identity() {
  const { data: profile } = useProfile();

  return (
    <div className="flex items-center gap-4">
      {profile ? (
        <UserAvatar profile={profile} size={72} />
      ) : (
        <div className="size-[72px] shrink-0 rounded-full bg-sunken" aria-hidden="true" />
      )}
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{profile?.displayName ?? UNKNOWN}</h1>
        {profile ? <p className="truncate text-sm text-muted">@{profile.username}</p> : null}
      </div>
    </div>
  );
}

function ProfileStats() {
  const { t, locale } = useT();
  const now = useNow();

  const quests = useQuests();
  const balance = useOrbsBalance();
  const appStats = useAppStats();
  const { data: library = [] } = useLibrary();

  const stats = useMemo(() => (quests.data ? questStats(quests.data.quests, now) : null), [quests.data, now]);
  const playtime = library.reduce((total, entry) => total + entry.totalSeconds, 0);

  const count = (value: number | undefined) => (value === undefined ? UNKNOWN : formatNumber(value, locale));
  const orbIcon = <OrbIcon />;

  return (
    <>
      <Group title={t("profile.orbs")} delay={0}>
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={orbIcon} label={t("profile.orbs.balance")} value={count(balance.data)} />
          <Stat
            icon={orbIcon}
            label={t("profile.orbs.claimed")}
            value={count(stats?.orbsClaimed)}
            hint={stats && stats.orbsToClaim > 0 ? t("profile.orbs.toClaim", { count: formatNumber(stats.orbsToClaim, locale) }) : undefined}
          />
          <Stat
            icon={orbIcon}
            label={t("profile.orbs.viaApp")}
            value={count(appStats.data?.orbsEarned)}
            hint={t("profile.orbs.viaAppHint")}
          />
        </div>
      </Group>

      <Group title={t("profile.quests")} delay={1}>
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t("profile.quests.completed")} value={count(stats?.completed)} />
          <Stat
            label={t("profile.quests.viaApp")}
            value={count(appStats.data?.questsCompleted)}
            hint={t("profile.quests.viaAppHint")}
          />
          <Stat label={t("profile.quests.expired")} value={count(stats?.expired)} />
          <Stat label={t("profile.quests.inProgress")} value={count(stats?.inProgress)} />
          <Stat label={t("profile.quests.available")} value={count(stats?.available)} />
          <Stat label={t("profile.quests.toClaim")} value={count(stats?.toClaim)} />
        </div>
        <p className="px-1 pt-2 text-xs text-subtle">{t("profile.scope")}</p>
      </Group>

      <Group title={t("profile.activity")} delay={2}>
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={<ClockIcon />} label={t("profile.activity.playtime")} value={formatDuration(playtime)} />
          <Stat icon={<Gamepad2Icon />} label={t("profile.activity.games")} value={formatNumber(library.length, locale)} />
          <Stat
            icon={<ClockIcon />}
            label={t("profile.activity.timeSaved")}
            value={appStats.data ? formatDuration(appStats.data.timeSavedSeconds) : UNKNOWN}
            hint={t("profile.activity.timeSavedHint")}
          />
        </div>
      </Group>

      <Group title={t("profile.weekly.title")} delay={3}>
        {appStats.data ? <WeeklyOrbs weeks={appStats.data.weekly} /> : null}
      </Group>

      <Group title={t("profile.recent")} delay={4}>
        {appStats.data && appStats.data.recent.length > 0 ? (
          <ol className="rounded-card bg-surface p-1.5 shadow-card">
            {appStats.data.recent.map((quest) => (
              <li
                key={quest.questId}
                className="flex items-center justify-between gap-4 rounded-inner px-3.5 py-2.5 [&:not(:last-child)]:mb-px"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{quest.name}</span>
                  <span className="block text-[13px] text-muted">{formatRelativeTime(quest.completedAt, now, locale)}</span>
                </span>
                {quest.orbs !== null ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums">
                    <OrbIcon className="size-4" />
                    {t("profile.recent.orbs", { count: formatNumber(quest.orbs, locale) })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-card bg-surface px-4 py-5 text-sm text-muted shadow-card">{t("profile.recent.empty")}</p>
        )}
      </Group>

      <Group title={t("profile.history.title")} delay={5}>
        <ActivityHistory now={now} />
      </Group>
    </>
  );
}

function NoAccount() {
  const { t } = useT();
  const navigate = useUiStore((state) => state.navigate);

  return (
    <div className="grid h-full place-items-center">
      <EmptyState
        icon={<UserRoundIcon />}
        title={t("profile.noAccount.title")}
        action={
          <Button
            variant="primary"
            onClick={() => {
              navigate("quests");
            }}
          >
            <TrophyIcon />
            {t("profile.noAccount.cta")}
          </Button>
        }
      >
        {t("profile.noAccount.body")}
      </EmptyState>
    </div>
  );
}

export default function ProfilePage() {
  const { t } = useT();
  const connection = useQuestsConnection();

  if (connection.isPending) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (!connection.data) return <NoAccount />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-7 px-8 pb-10 pt-7">
        <Identity />
        <ProfileStats />

        <footer className="pt-1 text-center text-[13px] text-subtle">
          {t("profile.madeBy")}{" "}
          <button
            type="button"
            onClick={() => {
              void openUrl(AUTHOR_URL);
            }}
            className="hit-40 rounded font-medium text-accent-text hover:underline"
          >
            @{AUTHOR_HANDLE}
          </button>
        </footer>
      </div>
    </div>
  );
}
