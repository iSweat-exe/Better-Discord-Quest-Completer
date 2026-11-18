import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SearchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { Badge, Spinner } from "@/components/ui/primitives";
import { guildIconUrl } from "@/lib/discord";
import { formatNumber, initialOf } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import type { Guild } from "@/types/domain";

import { ConfirmWriteDialog } from "./confirm-write-dialog";
import { useGuilds, useLeaveGuild } from "./queries";

/** Past this many servers, a filter field is shown. */
const FILTER_FROM = 8;

function GuildIcon({ guild }: { guild: Guild }) {
  const url = guildIconUrl(guild.id, guild.icon);
  const [failed, setFailed] = useState(false);

  return (
    <div className="img-outline relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-accent-soft text-sm font-semibold text-accent-text">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          width={36}
          height={36}
          className="size-full object-cover"
          onError={() => {
            setFailed(true);
          }}
        />
      ) : (
        <span aria-hidden="true">{initialOf(guild.name)}</span>
      )}
    </div>
  );
}

/** The servers the account is in, with the option to leave one (after a confirmation). */
export function GuildsSection() {
  const { t, locale } = useT();
  const guilds = useGuilds();
  const leave = useLeaveGuild();
  const [filter, setFilter] = useState("");
  const [leaving, setLeaving] = useState<Guild | null>(null);

  const list = guilds.data;
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? (list ?? []).filter((guild) => guild.name.toLowerCase().includes(needle)) : (list ?? []);
  }, [list, filter]);

  if (guilds.isPending) {
    return (
      <div className="grid place-items-center rounded-card bg-surface py-8 text-muted shadow-card">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (!list) {
    return <p className="rounded-card bg-surface px-4 py-5 text-sm text-muted shadow-card">{t("account.guilds.unavailable")}</p>;
  }
  if (list.length === 0) {
    return <p className="rounded-card bg-surface px-4 py-5 text-sm text-muted shadow-card">{t("account.guilds.empty")}</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 px-1 pb-2">
        <p className="text-xs text-subtle">{t("account.guilds.count", { count: list.length })}</p>
        {list.length >= FILTER_FROM ? (
          <div className="relative w-56">
            <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <TextInput
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              placeholder={t("account.guilds.filter")}
              aria-label={t("account.guilds.filter")}
              className="h-8 pl-8 text-[13px]"
            />
          </div>
        ) : null}
      </div>
      <ol className="max-h-96 overflow-y-auto rounded-card bg-surface p-1.5 shadow-card">
        {shown.map((guild) => (
          <li key={guild.id} className="flex items-center gap-3 rounded-inner px-2.5 py-2 [&:not(:last-child)]:mb-px hover:bg-raised">
            <GuildIcon guild={guild} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{guild.name}</span>
                {guild.owner ? <Badge tone="accent">{t("account.guilds.owner")}</Badge> : null}
              </span>
              {guild.memberCount !== null ? (
                <span className="block text-[13px] text-muted">
                  {t("account.guilds.members", { count: guild.memberCount, value: formatNumber(guild.memberCount, locale) })}
                </span>
              ) : null}
            </span>
            {/* An owner cannot leave: Discord asks to transfer or delete the server first. */}
            {!guild.owner ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLeaving(guild);
                }}
              >
                {t("account.guilds.leave")}
              </Button>
            ) : null}
          </li>
        ))}
        {shown.length === 0 ? <li className="px-3 py-4 text-sm text-muted">{t("account.guilds.noMatch")}</li> : null}
      </ol>

      <ConfirmWriteDialog
        open={leaving !== null}
        irreversible
        title={t("account.guilds.confirmTitle", { name: leaving?.name ?? "" })}
        confirmLabel={t("account.guilds.confirm")}
        pending={leave.isPending}
        onCancel={() => {
          setLeaving(null);
        }}
        onConfirm={() => {
          if (!leaving) return;
          const guild = leaving;
          leave.mutate(guild, {
            onSuccess: () => {
              setLeaving(null);
              toast.success(t("account.guilds.done", { name: guild.name }));
            },
          });
        }}
      >
        <p className="text-muted">{t("account.guilds.confirmBody")}</p>
      </ConfirmWriteDialog>
    </div>
  );
}
