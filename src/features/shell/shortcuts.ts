import type { Page } from "./ui-store";

/**
 * The pages that Ctrl/Cmd+1, 2, 3… open: the order of the sidebar, top to bottom,
 * then Settings. One list for the keys and for the hints shown beside each entry,
 * so they cannot drift apart when a page is added.
 */
export const SHORTCUT_PAGES: readonly Page[] = ["games", "quests", "shop", "presence", "logs", "settings"];

/** The digit that opens `page`, or `null` when it has no shortcut. */
export function shortcutDigit(page: Page): number | null {
  const index = SHORTCUT_PAGES.indexOf(page);
  return index === -1 ? null : index + 1;
}

/** The page a pressed digit key opens. */
export function pageForDigit(key: string): Page | null {
  const digit = Number.parseInt(key, 10);
  return Number.isInteger(digit) ? (SHORTCUT_PAGES[digit - 1] ?? null) : null;
}

const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

/**
 * The page a key press opens. It reads the physical key (`code`), not the character
 * (`key`): on an AZERTY keyboard the top row types `&`, `é`, `"`… unless Shift is held,
 * yet it is still the key marked 1, 2, 3 that the hint shows. The character is only
 * a fallback for events that carry no code.
 */
export function pageForKeys({ code, key }: { code?: string; key: string }): Page | null {
  const digit = DIGIT_CODE.exec(code ?? "")?.[1];
  return pageForDigit(digit ?? key);
}

/** How this system names its command key, for the hints. */
export function modifierLabel(platform = typeof navigator === "undefined" ? "" : navigator.platform): string {
  return /Mac|iPhone|iPad/.test(platform) ? "⌘" : "Ctrl";
}
