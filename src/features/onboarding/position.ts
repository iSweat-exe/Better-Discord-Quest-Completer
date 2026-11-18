/** A rectangle in viewport pixels. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const GAP = 12;
const MARGIN = 16;

/**
 * Where a card of `card` size goes next to `target`: below it if it fits, else
 * above, else to its right (sidebar entries), always kept inside the viewport.
 * Without a target the card is centered.
 */
export function placeCard(target: Box | null, card: { width: number; height: number }, viewport: { width: number; height: number }) {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, MARGIN), Math.max(MARGIN, max - MARGIN));

  if (!target) {
    return { top: (viewport.height - card.height) / 2, left: (viewport.width - card.width) / 2 };
  }

  const below = target.top + target.height + GAP;
  const above = target.top - GAP - card.height;
  const right = target.left + target.width + GAP;

  // A narrow element on the left edge (a sidebar entry): the card sits beside it.
  if (target.left + target.width < viewport.width / 3 && right + card.width <= viewport.width - MARGIN) {
    return { top: clamp(target.top + target.height / 2 - card.height / 2, viewport.height - card.height), left: right };
  }
  if (below + card.height <= viewport.height - MARGIN) {
    return { top: below, left: clamp(target.left + target.width / 2 - card.width / 2, viewport.width - card.width) };
  }
  if (above >= MARGIN) {
    return { top: above, left: clamp(target.left + target.width / 2 - card.width / 2, viewport.width - card.width) };
  }
  return { top: clamp(below, viewport.height - card.height), left: clamp(right, viewport.width - card.width) };
}
