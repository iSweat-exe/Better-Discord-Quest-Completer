import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/lib/i18n/use-t";
import { ipc } from "@/lib/ipc";

import { useUiStore } from "./ui-store";

/** Asked when closing the window would stop games that are still running. */
export function CloseDialog() {
  const { t } = useT();
  const runningCount = useUiStore((state) => state.closePrompt);
  const setClosePrompt = useUiStore((state) => state.setClosePrompt);

  const dismiss = () => {
    setClosePrompt(null);
  };

  return (
    <Modal
      open={runningCount !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
      title={t("close.title")}
      description={t("close.body", { count: runningCount ?? 0 })}
      className="w-[min(92vw,560px)]"
    >
      <div className="mt-6 flex flex-wrap justify-end gap-2 px-6 pb-6">
        <Button variant="ghost" onClick={dismiss}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={() => {
            dismiss();
            void ipc.hideToTray();
          }}
        >
          {t("close.minimize")}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            void ipc.quitApp();
          }}
        >
          {t("close.quit")}
        </Button>
      </div>
    </Modal>
  );
}
