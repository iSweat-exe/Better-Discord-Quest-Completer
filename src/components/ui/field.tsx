import { ChevronDownIcon, MinusIcon, PlusIcon } from "@/components/icons";
import { useId, useState, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

import { Button } from "./button";

const fieldClasses =
  "h-10 w-full rounded-control bg-surface px-3 text-sm shadow-field outline-none placeholder:text-subtle " +
  "transition-shadow duration-150 ease-out focus-visible:shadow-[0_0_0_2px_var(--accent-text)] " +
  "disabled:opacity-50 aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)]";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input type="text" autoComplete="off" spellCheck={false} className={cn(fieldClasses, className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative" data-icon-scope>
      <select className={cn(fieldClasses, "appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDownIcon size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  );
}

interface FieldProps {
  label: string;
  optional?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined }) => ReactNode;
}

/** Label + control + message, with the ids wired for assistive technology. */
export function Field({ label, optional, error, hint, children }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline gap-2 text-sm font-medium">
        {label}
        {optional ? <span className="text-xs font-normal text-subtle">{optional}</span> : null}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": message ? messageId : undefined })}
      {message ? (
        <p id={messageId} className={cn("mt-1.5 text-[13px]", error ? "text-danger" : "text-muted")}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

interface NumberStepperProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit: string;
  label: string;
  onCommit: (value: number) => void;
}

/** A number input with +/- buttons. The value is committed on blur or Enter. */
export function NumberStepper({ value, min, max, step = 5, unit, label, onCommit }: NumberStepperProps) {
  const { t } = useT();
  const [draft, setDraft] = useState<string | null>(null);

  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (!Number.isNaN(parsed) && clamp(parsed) !== value) onCommit(clamp(parsed));
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="iconSm"
        aria-label={t("common.decrease")}
        disabled={value <= min}
        onClick={() => {
          onCommit(clamp(value - step));
        }}
      >
        <MinusIcon />
      </Button>
      <input
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value.replace(/\D/g, "").slice(0, 3));
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(null);
        }}
        className={cn(fieldClasses, "h-8 w-14 rounded-lg px-0 text-center tabular-nums")}
      />
      <Button
        variant="secondary"
        size="iconSm"
        aria-label={t("common.increase")}
        disabled={value >= max}
        onClick={() => {
          onCommit(clamp(value + step));
        }}
      >
        <PlusIcon />
      </Button>
      <span className="ml-1 w-8 text-[13px] text-muted">{unit}</span>
    </div>
  );
}
