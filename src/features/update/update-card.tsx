import { DownloadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/use-t";

import { downloadPercent, useUpdateStore } from "./update-store";

/**
 * The sidebar's place for the "Update" button. It only shows up when a newer
 * version exists, and turns into a progress bar while it downloads.
 */
export function UpdateCard() {
  const { t } = useT();
  const info = useUpdateStore((state) => state.info);
  const phase = useUpdateStore((state) => state.phase);
  const progress = useUpdateStore((state) => state.progress);
  const setDialogOpen = useUpdateStore((state) => state.setDialogOpen);

  if (!info) return null;
  const downloading = phase === "downloading";
  const percent = downloadPercent(progress);

  return (
    <div className="mb-2 rounded-card bg-accent-soft p-3 animate-fade-up">
      <p className="flex items-center gap-2 text-[13px] font-medium text-accent-text">
        <span className="size-2 shrink-0 rounded-full bg-accent-text" aria-hidden="true" />
        {t("update.badge", { version: info.version })}
      </p>

      {downloading ? (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label={t("update.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(percent !== null ? { "aria-valuenow": percent } : {})}
            className="h-1.5 overflow-hidden rounded-full bg-sunken"
          >
            <div
              className="h-full rounded-full bg-accent-text transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${(percent ?? 100).toString()}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs tabular-nums text-muted">
            {percent === null ? t("update.downloadingUnknown") : t("update.downloading", { percent })}
          </p>
        </div>
      ) : (
        <Button
          variant="primary"
          size="sm"
          className="mt-2.5 w-full"
          onClick={() => {
            setDialogOpen(true);
          }}
        >
          <DownloadIcon />
          {t("update.cta")}
        </Button>
      )}
    </div>
  );
}
