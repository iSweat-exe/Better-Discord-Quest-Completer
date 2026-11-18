import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { placeCard, type Box } from "./position";

const MEASURE_EVERY_MS = 150;

/** The first visible element marked `data-tour={target}` (hidden pages keep theirs, at zero size). */
function findTarget(target: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const element of candidates) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return element;
  }
  return null;
}

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a !== null && b !== null && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * Where the element marked `data-tour={target}` is on screen, followed while it
 * moves (page change, resize, an animation): `null` while it is not visible.
 */
export function useTargetBox(target: string | null): Box | null {
  // Tagged with its target, so a box measured for the previous step is never shown for the next.
  const [measured, setMeasured] = useState<{ target: string; box: Box | null } | null>(null);

  useEffect(() => {
    if (target === null) return;
    const measure = () => {
      const rect = findTarget(target)?.getBoundingClientRect();
      const box = rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null;
      setMeasured((current) => (current?.target === target && sameBox(current.box, box) ? current : { target, box }));
    };
    const frame = window.requestAnimationFrame(measure);
    const timer = window.setInterval(measure, MEASURE_EVERY_MS);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [target]);

  return target !== null && measured?.target === target ? measured.box : null;
}

/** Where a card goes next to a target, once the card's own size is known. */
export function useCardPosition(box: Box | null) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const size = { width: card.offsetWidth, height: card.offsetHeight };
    setPosition(placeCard(box, size, { width: window.innerWidth, height: window.innerHeight }));
  }, [box]);

  return { cardRef, position };
}

