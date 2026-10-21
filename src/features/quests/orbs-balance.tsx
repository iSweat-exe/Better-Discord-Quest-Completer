import { OrbIcon } from "@/components/ui/orb-icon";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";

import { useOrbsBalance } from "./queries";

/** The Orbs the account holds. Renders nothing until Discord has answered. */
export function OrbsBalance() {
  const { t, locale } = useT();
  const { data: balance } = useOrbsBalance();

  if (balance === undefined) return null;

  const formatted = formatNumber(balance, locale);
  return (
    <p
      className="flex h-8 items-center gap-1.5 rounded-full bg-sunken px-3 text-sm font-medium tabular-nums"
      title={t("quests.orbs")}
    >
      <OrbIcon key={balance} className="size-[18px] shrink-0 animate-orb-pop" />
      <span className="sr-only">{t("quests.orbs")}: </span>
      {formatted}
    </p>
  );
}
