import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface ProgressRingProps {
  /** 0 to 1. */
  value: number;
  size?: number;
  strokeWidth?: number;
  complete?: boolean;
  /** What the ring says, for assistive technology (its figure is drawn, not read). */
  label?: string;
  /** The arc takes the hue of the surrounding `--game-hue` instead of the accent. */
  tinted?: boolean;
  children?: ReactNode;
  className?: string;
}

export function ProgressRing({
  value,
  size = 88,
  strokeWidth = 7,
  complete = false,
  label,
  tinted = false,
  children,
  className,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, value));

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "img", "aria-label": label } : {})}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-line-strong"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-1000 ease-linear",
            complete ? "stroke-success" : tinted ? "game-tint-stroke" : "stroke-accent-text",
          )}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
