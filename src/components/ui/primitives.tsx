import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-sunken px-1.5 font-mono text-[11px] font-medium text-muted",
        "shadow-[inset_0_-1px_0_var(--line)]",
        className,
      )}
      {...props}
    />
  );
}

const badgeTones = {
  neutral: "bg-sunken text-muted",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
} as const;

interface BadgeProps extends ComponentProps<"span"> {
  tone?: keyof typeof badgeTones;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium [&_svg]:size-3",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-4 animate-spin text-current", className)}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text [&_svg]:size-6">
        {icon}
      </div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {children ? <p className="mt-1.5 max-w-sm text-sm text-muted">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** A titled settings/form section rendered as a card. */
export function Section({
  title,
  description,
  children,
  className,
  delay = 0,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Stagger index: each step delays the entrance by 60ms. */
  delay?: number;
}) {
  return (
    <section className={cn("animate-fade-up", className)} style={{ animationDelay: `${(delay * 60).toString()}ms` }}>
      <h2 className="px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-subtle">{title}</h2>
      {description ? <p className="px-1 pb-2 text-sm text-muted">{description}</p> : null}
      {/* Rows inside use 6px of padding and a 10px radius: 16 = 10 + 6. */}
      <div className="rounded-card bg-surface p-1.5 shadow-card">{children}</div>
    </section>
  );
}

interface SettingRowProps {
  title: string;
  hint?: string;
  /** Makes the whole row the label of its control (bigger click target). */
  htmlFor?: string;
  children: ReactNode;
}

export function SettingRow({ title, hint, htmlFor, children }: SettingRowProps) {
  const Tag = htmlFor ? "label" : "div";
  return (
    <Tag
      {...(htmlFor ? { htmlFor } : {})}
      className="flex min-h-14 items-center justify-between gap-6 rounded-inner px-3.5 py-2.5 [&:not(:last-child)]:mb-px"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {hint ? <span className="mt-0.5 block text-[13px] leading-snug text-muted">{hint}</span> : null}
      </span>
      <span className="shrink-0">{children}</span>
    </Tag>
  );
}
