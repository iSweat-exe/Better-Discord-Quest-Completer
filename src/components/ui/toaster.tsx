import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { Toaster } from "sonner";

/** What the icon chip of each kind of toast looks like: the same soft tint as the app's badges. */
const TONES = {
  success: "[&_[data-icon]]:bg-success-soft [&_[data-icon]]:text-success",
  error: "[&_[data-icon]]:bg-danger-soft [&_[data-icon]]:text-danger",
  warning: "[&_[data-icon]]:bg-warning-soft [&_[data-icon]]:text-warning",
  info: "[&_[data-icon]]:bg-accent-soft [&_[data-icon]]:text-accent-text",
  loading: "[&_[data-icon]]:bg-sunken [&_[data-icon]]:text-muted",
} as const;

/**
 * The app's notifications. Sonner brings the stacking and the motion; everything
 * you see comes from the app's tokens, so a toast looks like a card of the app
 * (same surface, radius, shadow and type) in both themes.
 */
export function AppToaster() {
  return (
    <Toaster
      position="bottom-right"
      offset={20}
      gap={8}
      visibleToasts={3}
      icons={{
        success: <CircleCheck size={20} aria-hidden="true" />,
        error: <CircleAlert size={20} aria-hidden="true" />,
        warning: <TriangleAlert size={20} aria-hidden="true" />,
        info: <Info size={20} aria-hidden="true" />,
        loading: <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />,
      }}
      toastOptions={{
        duration: 4000,
        unstyled: true,
        classNames: {
          toast:
            "pointer-events-auto flex w-[min(92vw,360px)] items-center gap-3 rounded-card bg-surface p-1.5 pr-4 font-sans text-fg shadow-pop",
          icon: "m-0 grid size-10 shrink-0 place-items-center rounded-inner",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "text-sm font-medium leading-snug text-fg",
          description: "text-[13px] leading-snug text-muted",
          success: TONES.success,
          error: TONES.error,
          warning: TONES.warning,
          info: TONES.info,
          loading: TONES.loading,
        },
      }}
    />
  );
}
