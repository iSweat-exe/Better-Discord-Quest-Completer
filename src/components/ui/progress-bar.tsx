import { cn } from "@/lib/cn";

interface ProgressBarProps {
  /** From 0 to 1; `null` when the progress is not known (the bar is then full). */
  value: number | null;
  label?: string;
  /** Speed of the fill: a slow tick wants a long, linear one. */
  motion?: string;
  className?: string;
}

/**
 * A thin progress bar. The fill slides instead of growing in width, so the
 * animation stays on the compositor (no layout work on every tick) and its
 * rounded end keeps its shape at any value.
 */
export function ProgressBar({ value, label, motion = "duration-500 ease-out", className }: ProgressBarProps) {
  const ratio = Math.min(1, Math.max(0, value ?? 1));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(value !== null ? { "aria-valuenow": Math.round(ratio * 100) } : {})}
      className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", className)}
    >
      <div
        className={cn("size-full rounded-full bg-accent-text transition-transform motion-reduce:transition-none", motion)}
        style={{ transform: `translateX(${((ratio - 1) * 100).toString()}%)` }}
      />
    </div>
  );
}
