import type { ReactNode } from "react";

import { TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/use-t";

interface ConfirmWriteDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  /** What exactly will change on the account. */
  children: ReactNode;
  confirmLabel: string;
  pending: boolean;
  /** Shown when the write cannot be undone from the app. */
  irreversible?: boolean;
}

/**
 * The last step before the app writes on the user's real Discord account: it says what
 * will change, that Discord sees it, and that it counts in the ban-risk level.
 */
export function ConfirmWriteDialog({
  open,
  onCancel,
  onConfirm,
  title,
  children,
  confirmLabel,
  pending,
  irreversible = false,
}: ConfirmWriteDialogProps) {
  const { t } = useT();

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
      title={title}
      className="w-[min(92vw,520px)]"
    >
      <div className="px-6 pt-3">
        <div className="text-sm">{children}</div>
        <div className="mt-4 flex gap-3 rounded-inner bg-warning-soft p-3 text-[13px] leading-snug text-warning" role="note">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-semibold">{t("account.write.warningTitle")}</p>
            <p className="mt-0.5">{t("account.write.warningBody")}</p>
            {irreversible ? <p className="mt-1 font-medium">{t("account.write.irreversible")}</p> : null}
          </div>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2 px-6 pb-6">
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
