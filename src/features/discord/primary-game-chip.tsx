import { Tooltip } from "@/components/ui/tooltip";
import { useSessionStore } from "@/features/sessions/session-store";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

import { usePrimaryGame } from "./queries";

/**
 * Which game Discord shows as "Playing …" right now, while fake games run.
 * Discord names only one game at a time: when it is not one of ours, the fake
 * games are confirmed only at Discord's 5-minute heartbeat, which this explains.
 */
export function PrimaryGameChip() {
  const { t } = useT();
  const running = useSessionStore((state) => state.sessions.length > 0);
  const { data: primary } = usePrimaryGame(running);

  if (!running || primary === undefined) return null;

  const ours = primary?.ours ?? false;
  const label = primary ? t("discord.primary", { name: primary.name }) : t("discord.primaryNone");
  const hint = primary === null ? t("discord.primaryNoneHint") : ours ? t("discord.primaryOursHint") : t("discord.primaryOtherHint");

  return (
    <Tooltip content={hint}>
      <span
        role="status"
        tabIndex={0}
        className="inline-flex h-11 min-w-0 max-w-64 shrink items-center gap-2 rounded-control bg-surface px-3.5 text-[13px] font-medium shadow-card"
      >
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", ours ? "bg-success" : "bg-warning")} />
        <span className="truncate">{label}</span>
      </span>
    </Tooltip>
  );
}
