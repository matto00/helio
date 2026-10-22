import { useEffect, useRef, useState } from "react";

/** A change is shown once no newer change has arrived for this long (and the browser is idle). */
export const QUIET_MS = 250;
/** The longest a changed value waits while changes keep arriving (a long drag still updates now and then). */
export const MAX_WAIT_MS = 1500;
/** Once quiet, the longest to wait for an idle moment. */
const IDLE_TIMEOUT_MS = 200;

function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(handle);
  }
  run();
  return () => undefined;
}

/**
 * HEL-1632 (design.md D6 fallback): the value to RENDER the expensive live Output from. The first value is shown at once.
 * A change is shown only after the value has been quiet for `QUIET_MS` (then at an idle moment), or `MAX_WAIT_MS` after
 * the first unshown change, and every change before that replaces the pending one, so a burst of edits costs ONE render of
 * the latest value and none of it (ECharts `setOption` included) sits between one edit and the next one's handler. That is
 * what `useDeferredValue` cannot promise: a deferred render still runs synchronously once it starts, and on a slow runner
 * it started between two keystrokes.
 */
export function useIdleCoalesced<T>(value: T): T {
  const [shown, setShown] = useState(value);
  const pendingSince = useRef<number | null>(null);
  useEffect(() => {
    if (Object.is(value, shown)) {
      pendingSince.current = null;
      return;
    }
    const now = performance.now();
    pendingSince.current ??= now;
    const wait = Math.min(QUIET_MS, Math.max(0, pendingSince.current + MAX_WAIT_MS - now));
    let cancelIdle = () => undefined as void;
    const timer = window.setTimeout(() => {
      // Past the cap the value is shown directly. Waiting for idle here would let the next change cancel the pending idle
      // callback, and under a continuous burst a busy browser never reaches it: the cap would not hold.
      const capped =
        pendingSince.current !== null && performance.now() - pendingSince.current >= MAX_WAIT_MS;
      if (capped) {
        // The next unshown change starts a fresh wait.
        pendingSince.current = null;
        setShown(value);
      } else cancelIdle = whenIdle(() => setShown(value));
    }, wait);
    return () => {
      window.clearTimeout(timer);
      cancelIdle();
    };
  }, [value, shown]);
  return shown;
}
