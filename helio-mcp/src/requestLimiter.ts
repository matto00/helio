/**
 * Per-call in-flight cap for `buildWorkspaceContext` (HEL-1619 design D8).
 *
 * `createLimiter(max)` runs at most `max` async functions at once and starts queued ones in FIFO
 * order. `limitApi` wraps EVERY method of a `HelioApi` so each leaf request acquires a slot for its
 * own duration only. A slot is never held while waiting on another limited call, so a task that
 * awaits a deduped promise (the panel-controls snapshot) can never starve the call it waits for --
 * the pool-deadlock a per-task limiter would risk.
 */

import type { HelioApi } from "./helioApi.js";

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(max: number): Limiter {
  if (!Number.isInteger(max) || max < 1)
    throw new Error(`limiter max must be an integer >= 1, got ${max}`);
  let active = 0;
  const waiting: Array<() => void> = [];
  // A finished call hands its slot straight to the next waiter (active is unchanged), so a newly
  // arriving call can never slip in between the release and the waiter resuming and exceed `max`.
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** A `HelioApi` whose every method call runs through `limit`. Methods keep their own `this`, so a
 *  composite method (e.g. `getPipeline`'s two GETs) occupies ONE slot and never re-enters the limiter. */
export function limitApi(api: HelioApi, limit: Limiter): HelioApi {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) =>
        limit(async () => await (value as (...a: unknown[]) => unknown).apply(target, args));
    },
  });
}
