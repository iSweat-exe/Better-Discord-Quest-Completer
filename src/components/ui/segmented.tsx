import { cn } from "@/lib/cn";
import { radioGroupKeyDown, radioTabIndex } from "@/lib/radio-group";

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
  className?: string;
}

/** A radio group styled as a segmented control (arrow keys move the selection). */
export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  const values = options.map((option) => option.value);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={radioGroupKeyDown(values, value, onChange)}
      // Outer radius 10 = inner radius 6 + padding 4.
      className={cn("inline-flex gap-0.5 rounded-control bg-sunken p-1", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={radioTabIndex(values, value, option.value)}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              "hit-40 h-8 rounded-[6px] px-3 text-[13px] font-medium",
              "transition-[background-color,color,box-shadow] duration-150 ease-out",
              selected ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
