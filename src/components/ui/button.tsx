import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

const base =
  "relative inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium " +
  "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out " +
  "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const variants = {
  primary:
    "bg-accent text-on-accent shadow-[inset_0_1px_0_oklch(1_0_0/0.16),0_1px_2px_oklch(0_0_0/0.25)] hover:bg-accent-hover",
  secondary: "bg-surface text-fg shadow-field hover:bg-raised",
  ghost: "text-muted hover:bg-raised hover:text-fg",
  danger: "bg-danger-soft text-danger hover:bg-danger/20",
} as const;

const sizes = {
  md: "h-10 gap-2 rounded-control px-4 text-sm",
  sm: "hit-40 h-8 gap-1.5 rounded-lg px-3 text-[13px]",
  icon: "size-10 rounded-control",
  iconSm: "hit-40 size-8 rounded-lg",
} as const;

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** Disables the press animation, for controls where it would distract. */
  static?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  static: isStatic = false,
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], !isStatic && "active:scale-[0.96]", className)}
      {...props}
    />
  );
}
