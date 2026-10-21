import { IpcError } from "@/lib/ipc";
import type { Translate } from "@/lib/i18n";

/** A message fit for the user, localized by error kind. */
export function errorMessage(error: unknown, t: Translate): string {
  if (error instanceof IpcError && error.kind !== "unknown") {
    return t(`error.${error.kind}`, { message: error.message });
  }

  const message = error instanceof Error ? error.message : String(error);
  return t("error.unknown", { message });
}
