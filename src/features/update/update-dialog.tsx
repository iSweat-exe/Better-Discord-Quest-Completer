import { DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/primitives";
import { useSessionStore } from "@/features/sessions/session-store";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-t";
import { useNow } from "@/lib/use-now";

import { useInstallUpdate } from "./queries";
import { downloadPercent, useUpdateStore } from "./update-store";

/** Release notes and the final "update now". Renders nothing without an update. */
export function UpdateDialog() {
  const { t, locale } = useT();
  const now = useNow();
  const info = useUpdateStore((state) => state.info);
  const open = useUpdateStore((state) => state.dialogOpen);
  const phase = useUpdateStore((state) => state.phase);
  const progress = useUpdateStore((state) => state.progress);
  const setDialogOpen = useUpdateStore((state) => state.setDialogOpen);
  const gamesRunning = useSessionStore((state) => state.sessions.length > 0);
  const install = useInstallUpdate();

  if (!info) return null;
  const downloading = phase === "downloading";
  const percent = downloadPercent(progress);

  return (
    <Modal
      open={open}
      // Closing in the middle of a download would hide it, not stop it.
      onOpenChange={(next) => {
        if (!downloading) setDialogOpen(next);
      }}
      title={t("update.title")}
      description={t("update.versions", { current: info.currentVersion, next: info.version })}
    >
      <div className="space-y-4 px-6 pb-6 pt-4">
        <div>
          <p className="mb-1.5 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-subtle">
            {t("update.notes")}
            {info.publishedAt !== null ? (
              <span className="font-normal normal-case tracking-normal">
                {formatRelativeTime(info.publishedAt, now, locale)}
              </span>
            ) : null}
          </p>
          {/* Plain text on purpose: release notes come from the network and are never rendered as HTML. */}
          <div
            data-selectable
            className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-inner bg-sunken p-3 text-[13px] leading-relaxed"
          >
            {info.notes ?? t("update.noNotes")}
          </div>
        </div>

        {gamesRunning ? <p className="text-[13px] text-warning">{t("update.warnGames")}</p> : null}
        <p className="text-xs text-subtle">{t("update.restart")}</p>

        {downloading ? (
          <p className="flex items-center gap-2 text-sm tabular-nums text-muted" aria-live="polite">
            <Spinner />
            {percent === null ? t("update.downloadingUnknown") : t("update.downloading", { percent })}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            disabled={downloading}
            onClick={() => {
              setDialogOpen(false);
            }}
          >
            {t("update.later")}
          </Button>
          <Button
            variant="primary"
            disabled={downloading}
            onClick={() => {
              install.mutate();
            }}
          >
            <DownloadIcon />
            {t("update.install")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
