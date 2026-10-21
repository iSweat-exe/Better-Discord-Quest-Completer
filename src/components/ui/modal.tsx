import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Visually hides the title (it stays available to screen readers). */
  hideTitle?: boolean;
  children?: ReactNode;
  className?: string;
  /** Anchors the dialog near the top, like a command palette. */
  placement?: "center" | "top";
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  children,
  className,
  placement = "center",
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
        <Dialog.Content
          // Without a description, opt out explicitly instead of triggering Radix's warning.
          {...(description ? {} : { "aria-describedby": undefined })}
          className={cn(
            "fixed left-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 rounded-card bg-surface shadow-pop",
            "data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in",
            placement === "center" ? "top-1/2 -translate-y-1/2" : "top-[12vh]",
            className,
          )}
        >
          <Dialog.Title
            className={cn("text-base font-semibold tracking-tight", hideTitle ? "sr-only" : "px-6 pt-6")}
          >
            {title}
          </Dialog.Title>
          {description ? (
            <Dialog.Description className="px-6 pt-1.5 text-sm text-muted">{description}</Dialog.Description>
          ) : null}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
