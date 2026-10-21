import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface SwapIconProps {
  /** Shows `to` instead of `from`. */
  swapped: boolean;
  from: ReactNode;
  to: ReactNode;
  /** Size of the slot both icons share. */
  className?: string;
}

/** One icon of the pair: it fades, shrinks and blurs out, and back in the other way round. */
function Layer({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "col-start-1 row-start-1 grid place-items-center",
        "transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
        shown ? "opacity-100 scale-100 blur-none" : "opacity-0 scale-[0.25] blur-[4px]",
      )}
    >
      {children}
    </span>
  );
}

/**
 * Swaps an icon for another to confirm what just happened (copied, shown, hidden).
 * Both icons stay in the DOM and share one slot, so the swap can be interrupted
 * halfway and reversed without a jump.
 */
export function SwapIcon({ swapped, from, to, className }: SwapIconProps) {
  return (
    <span className={cn("inline-grid size-4 shrink-0 place-items-center", className)} aria-hidden="true">
      <Layer shown={!swapped}>{from}</Layer>
      <Layer shown={swapped}>{to}</Layer>
    </span>
  );
}
