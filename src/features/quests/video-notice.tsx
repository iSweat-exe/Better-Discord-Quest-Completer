import { openUrl } from "@tauri-apps/plugin-opener";
import { Clapperboard } from "lucide-react";

import { ExternalLinkIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { OrbIcon } from "@/components/ui/orb-icon";
import { formatDuration, formatNumber, formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { QUESTS_URL } from "@/lib/links";
import type { Quest } from "@/types/domain";

/**
 * Video quests (an ad to watch) are validated by Discord's own player: no fake
 * game can do them. They are only pointed out, so they are not missed.
 */
export function VideoNotice({ quests, now }: { quests: Quest[]; now: number }) {
  const { t, locale } = useT();
  if (quests.length === 0) return null;

  const title = t("quests.video.title", { count: quests.length });

  return (
    <section className="rounded-card bg-accent-soft p-4 text-accent-text" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Clapperboard size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-[13px] opacity-90">{t("quests.video.body")}</p>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            void openUrl(QUESTS_URL);
          }}
        >
          <ExternalLinkIcon size={16} />
          {t("quests.video.open")}
        </Button>
      </div>

      <ul className="mt-3 flex flex-col gap-1.5 border-t border-current/15 pt-3 text-[13px]">
        {quests.map((quest) => {
          const seconds = quest.tasks.find((task) => task.kind.startsWith("watchVideo"))?.targetSeconds;
          return (
            <li key={quest.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="min-w-0 truncate font-medium">{quest.name}</span>
              {seconds !== undefined ? <span className="opacity-80">{formatDuration(seconds)}</span> : null}
              {quest.rewardOrbs !== null ? (
                <span className="flex items-center gap-1 tabular-nums">
                  <OrbIcon className="size-3.5" />
                  {formatNumber(quest.rewardOrbs, locale)}
                </span>
              ) : quest.reward ? (
                <span className="opacity-80">{quest.reward}</span>
              ) : null}
              {quest.expiresAt !== null ? (
                <span className="opacity-80">
                  {t("quests.expires", { when: formatRelativeTime(quest.expiresAt, now, locale) })}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
