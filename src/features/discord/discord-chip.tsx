import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import { Tooltip } from "@/components/ui/tooltip";

import { useDiscordStatus } from "./queries";

/** Tells at a glance whether Discord can detect games on this machine. */
export function DiscordChip() {
  const { t } = useT();
  const { data: status } = useDiscordStatus();
  if (!status) return null;

  const ok = status.running && status.client !== null;
  const label = ok
    ? t("discord.running", { client: status.client ?? "Discord" })
    : status.unsupportedClient
      ? t("discord.unsupported", { client: status.unsupportedClient })
      : t("discord.missing");
  const hint = ok ? null : status.unsupportedClient ? t("discord.unsupportedHint") : t("discord.missingHint");

  const chip = (
    <span
      role="status"
      tabIndex={hint ? 0 : -1}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-control bg-surface px-3.5 text-[13px] font-medium shadow-card"
    >
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", ok ? "bg-success" : "bg-warning")}
      />
      {label}
    </span>
  );

  return hint ? <Tooltip content={hint}>{chip}</Tooltip> : chip;
}
