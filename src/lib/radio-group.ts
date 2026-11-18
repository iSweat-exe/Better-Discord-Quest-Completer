import type { KeyboardEvent } from "react";

/**
 * The option a key moves to in a radio group, as the WAI-ARIA pattern asks:
 * arrows go to the next or previous option (wrapping around), Home and End to
 * the first and last. `null` for any other key.
 */
export function nextRadioIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Keyboard handling for a `role="radiogroup"` whose options are `role="radio"`
 * buttons: the arrows select the next option and move the focus to it. Pair it
 * with a roving `tabIndex` (0 on the selected option, -1 on the others), so Tab
 * enters and leaves the group in one step.
 */
export function radioGroupKeyDown<T>(values: readonly T[], selected: T, onSelect: (value: T) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    const next = nextRadioIndex(event.key, Math.max(values.indexOf(selected), 0), values.length);
    if (next === null) return;

    event.preventDefault();
    const value = values[next];
    if (value === undefined) return;
    onSelect(value);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
}

/** The roving `tabIndex` of an option: only one option of the group is in the Tab order. */
export function radioTabIndex<T>(values: readonly T[], selected: T, value: T): 0 | -1 {
  const focusable = values.includes(selected) ? selected : values[0];
  return value === focusable ? 0 : -1;
}
