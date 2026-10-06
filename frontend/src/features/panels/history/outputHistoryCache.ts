import type { OutputHistory } from "./outputHistoryService";

/** HEL-1275 design.md D1 — module-level history cache modelled on `provenanceCache.ts`: the
 *  in-flight promise is shared (N consumers of one Output make one request), the resolved value is
 *  kept for the page lifetime, a rejected load is evicted so a later mount can retry, and a
 *  generation counter stops a load that was in flight at invalidation from repopulating the cache
 *  with a pre-run head. */
const promises = new Map<string, Promise<OutputHistory>>();
const values = new Map<string, OutputHistory>();
const listeners = new Set<() => void>();
const generations = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** The run's `succeeded` event is published before the history write lands, so a fan-out refetch
 *  can read the pre-run head; one delayed retry covers that window. */
export const HISTORY_RETRY_DELAY_MS = 1500;

export function outputHistoryKey(outputId: string): string {
  return `output:${outputId}`;
}

export function publicHistoryKey(dashboardId: string, panelId: string): string {
  return `public:${dashboardId}:${panelId}`;
}

export function getCachedHistory(key: string): OutputHistory | undefined {
  return values.get(key);
}

export function loadHistory(
  key: string,
  fetcher: () => Promise<OutputHistory>,
): Promise<OutputHistory> {
  const existing = promises.get(key);
  if (existing) return existing;
  const generation = generations.get(key) ?? 0;
  const promise = fetcher().then(
    (value) => {
      if ((generations.get(key) ?? 0) === generation) {
        values.set(key, value);
        listeners.forEach((l) => l());
      }
      return value;
    },
    (error: unknown) => {
      if (promises.get(key) === promise) promises.delete(key);
      throw error;
    },
  );
  promises.set(key, promise);
  return promise;
}

/** Drops the in-flight promise and bumps the generation. The last resolved value is KEPT so the
 *  panel does not flash back to its loaded-rows fallback while the refetch is in flight. */
export function invalidateHistory(key: string): void {
  generations.set(key, (generations.get(key) ?? 0) + 1);
  promises.delete(key);
}

/** A pipeline run just reached a terminal state: refetch, and if the head did not advance (the
 *  history write may land just after the event), retry once after `HISTORY_RETRY_DELAY_MS`. */
export function refreshHistory(key: string, fetcher: () => Promise<OutputHistory>): void {
  const before = values.get(key)?.current?.capturedAt ?? null;
  invalidateHistory(key);
  const pending = retryTimers.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
    retryTimers.delete(key);
  }
  loadHistory(key, fetcher).then(
    (value) => {
      if ((value.current?.capturedAt ?? null) !== before) return;
      retryTimers.set(
        key,
        setTimeout(() => {
          retryTimers.delete(key);
          invalidateHistory(key);
          loadHistory(key, fetcher).catch(() => undefined);
        }, HISTORY_RETRY_DELAY_MS),
      );
    },
    () => undefined,
  );
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetHistoryCache(): void {
  promises.clear();
  values.clear();
  listeners.clear();
  generations.clear();
  retryTimers.forEach((t) => clearTimeout(t));
  retryTimers.clear();
}
