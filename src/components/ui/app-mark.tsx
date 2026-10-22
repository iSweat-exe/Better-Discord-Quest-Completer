import { cn } from "@/lib/cn";

/**
 * The app's own mark, the feather: a light touch for a tool that does the waiting.
 * It stands in for a generic icon in the states people see first (nothing to do,
 * nothing started yet), and leans a little when pointed at.
 */
export function AppMark({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={cn(
        "origin-bottom transition-transform duration-300 ease-out hover:-rotate-6 motion-reduce:transition-none",
        className,
      )}
    />
  );
}
