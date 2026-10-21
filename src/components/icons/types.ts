import type { HTMLAttributes } from "react";

/** What an animated icon exposes through its `ref`. */
export interface IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

export interface IconProps extends HTMLAttributes<HTMLDivElement> {
  /** Edge length in pixels (16 by default). */
  size?: number;
}
