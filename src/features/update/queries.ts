import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { useT } from "@/lib/i18n/use-t";
import { ipc } from "@/lib/ipc";

import { useUpdateStore } from "./update-store";

/** Looks for a newer version now; says so when there is none. */
export function useCheckForUpdate() {
  const { t } = useT();

  return useMutation({
    mutationFn: async () => {
      const { setPhase, setInfo } = useUpdateStore.getState();
      setPhase("checking");
      try {
        setInfo(await ipc.checkForUpdate());
      } finally {
        setPhase("idle");
      }
    },
    onSuccess: () => {
      if (useUpdateStore.getState().info === null) toast.success(t("update.upToDate"));
    },
  });
}

/** Downloads and installs the version that was found; the app restarts at the end. */
export function useInstallUpdate() {
  return useMutation({
    mutationFn: async () => {
      const { setPhase, setProgress } = useUpdateStore.getState();
      setProgress(null);
      setPhase("downloading");
      try {
        await ipc.installUpdate();
      } catch (error) {
        // The app only comes back to life here when the update failed.
        setPhase("idle");
        throw error;
      }
    },
  });
}
