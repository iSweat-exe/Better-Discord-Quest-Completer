import { useSyncExternalStore } from "react";

/**
 * A clock that ticks every `interval` milliseconds. All consumers share one
 * timer, which only runs while at least one component is subscribed.
 *
 * Its value is always a whole second: reads between two ticks must return the
 * same number (React requires it), and that keeps it within a second of the
 * real time however rarely it ticks.
 */
function createClock(interval: number) {
  const listeners = new Set<() => void>();
  let timer: number | undefined;
  const quantize = (timestamp: number) => Math.floor(timestamp / 1000) * 1000;
  let current = quantize(Date.now());

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);

      if (listeners.size === 1) {
        current = quantize(Date.now());
        timer = window.setInterval(() => {
          current = quantize(Date.now());
          listeners.forEach((notify) => {
            notify();
          });
        }, interval);
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.clearInterval(timer);
      };
    },

    getSnapshot: (): number => {
      // Nobody is listening, so `current` may be stale: refresh it.
      if (listeners.size === 0) current = quantize(Date.now());
      return current;
    },
  };
}

const seconds = createClock(1000);
const minutes = createClock(60_000);

/** The current time, refreshed every second: for what counts seconds (timers). */
export function useNow(): number {
  return useSyncExternalStore(seconds.subscribe, seconds.getSnapshot);
}

/**
 * The current time, refreshed every minute: for what is worded in minutes or
 * more ("expires in 3 days"). Lists should prefer it, so they are not rebuilt
 * every second for a text that only changes once a minute.
 */
export function useMinute(): number {
  return useSyncExternalStore(minutes.subscribe, minutes.getSnapshot);
}
