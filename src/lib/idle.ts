/**
 * Runs `task` once the browser has nothing better to do, so background work
 * (preloading, warming caches) never competes with what the user is doing.
 * Returns a function that cancels it.
 */
export function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 2000 });
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  const handle = window.setTimeout(task, 200);
  return () => {
    window.clearTimeout(handle);
  };
}
