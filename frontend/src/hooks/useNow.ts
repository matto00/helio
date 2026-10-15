import { useSyncExternalStore } from "react";

interface Ticker {
  now: number;
  listeners: Set<() => void>;
  handle: ReturnType<typeof setInterval> | null;
  /** Stable identities per interval: `useSyncExternalStore` resubscribes whenever `subscribe` changes, and a
   *  resubscribe tears the interval down and restarts it, so an inline closure froze the labels while the user
   *  interacted (every re-render pushed the next tick 60 s out). */
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
}

/** One shared ticker per interval length, so many consumers read the same `now`. */
const tickers = new Map<number, Ticker>();

function tickerFor(intervalMs: number): Ticker {
  let ticker = tickers.get(intervalMs);
  if (ticker === undefined) {
    const created: Ticker = {
      now: Date.now(),
      listeners: new Set(),
      handle: null,
      subscribe: (listener) => {
        created.listeners.add(listener);
        if (created.handle === null) {
          created.handle = setInterval(() => {
            created.now = Date.now();
            created.listeners.forEach((notify) => notify());
          }, intervalMs);
        }
        return () => {
          created.listeners.delete(listener);
          if (created.listeners.size === 0 && created.handle !== null) {
            clearInterval(created.handle);
            created.handle = null;
          }
        };
      },
      getSnapshot: () => {
        if (created.handle === null) {
          const current = Date.now();
          if (current - created.now >= intervalMs) created.now = current;
        }
        return created.now;
      },
    };
    ticker = created;
    tickers.set(intervalMs, ticker);
  }
  return ticker;
}

/** Test-only: clears module state (running intervals and stored values) between jest tests. */
export function resetUseNowForTests(): void {
  for (const ticker of tickers.values()) {
    if (ticker.handle !== null) clearInterval(ticker.handle);
  }
  tickers.clear();
}

/** A `Date.now()` value that changes only every `intervalMs`, shared by every consumer of that interval. Unlike
 *  reading `Date.now()` in render, an unrelated re-render cannot change it (HEL-1605: relative-time labels in a
 *  table must not change length between the two presses of a double-click). The snapshot is the stored value;
 *  while no ticker runs and the value is older than the interval it is refreshed first, so a consumer mounting
 *  after idle never ages rows against a stale `now`. `subscribe` and `getSnapshot` keep one identity per interval,
 *  so a re-render never resubscribes (and so never restarts the interval or runs the idle refresh). */
export function useNow(intervalMs: number): number {
  const { subscribe, getSnapshot } = tickerFor(intervalMs);
  return useSyncExternalStore(subscribe, getSnapshot);
}
