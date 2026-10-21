import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A boolean that turns on when `flash` is called and off again after `duration`
 * milliseconds: the "Copied!" state of a button.
 */
export function useFlash(duration = 1500): [on: boolean, flash: () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  const flash = useCallback(() => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOn(false);
    }, duration);
  }, [duration]);

  return [on, flash];
}
