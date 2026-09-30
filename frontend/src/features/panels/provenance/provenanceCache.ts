import { getAssertionStatus } from "../../pipelines/services/outputService";
import type { Provenance } from "./provenanceService";

/** HEL-1207 design.md Decision 4 / A4 — module-level provenance cache. The in-flight promise is
 *  shared (two concurrent opens make one request) and the resolved value is kept for the page
 *  lifetime so a second open is served without a request. A rejected load is evicted so the next
 *  open can retry. */
const promises = new Map<string, Promise<Provenance>>();
const values = new Map<string, Provenance>();
const listeners = new Set<() => void>();
const invalidationListeners = new Set<() => void>();
/** Bumped per key on invalidation so a load that was already in flight cannot repopulate the cache
 *  with a pre-run chain after the run event evicted it. */
const generations = new Map<string, number>();

export function outputProvenanceKey(outputId: string): string {
  return `output:${outputId}`;
}

export function publicProvenanceKey(dashboardId: string, panelId: string): string {
  return `public:${dashboardId}:${panelId}`;
}

export function getCachedProvenance(key: string): Provenance | undefined {
  return values.get(key);
}

export function loadProvenance(
  key: string,
  fetcher: () => Promise<Provenance>,
): Promise<Provenance> {
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

/** A pipeline run just reached a terminal state: evict so the next open refetches. */
export function invalidateProvenance(key: string): void {
  generations.set(key, (generations.get(key) ?? 0) + 1);
  promises.delete(key);
  values.delete(key);
  listeners.forEach((l) => l());
  invalidationListeners.forEach((l) => l());
}

/** Fires only on invalidation (not on load) — the Invalid-data badge re-reads status then. */
export function subscribeProvenanceInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

export function subscribeProvenance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetProvenanceCache(): void {
  promises.clear();
  values.clear();
  listeners.clear();
  invalidationListeners.clear();
  generations.clear();
  inFlightStatus.clear();
}

/** HEL-1207 A4 — one shared in-flight `getAssertionStatus` per output, so N consumers of one
 *  output make one request. Deliberately in-flight only (entry dropped on settle): a cached result
 *  would leave the Invalid-data badge stale after a later pipeline run. */
const inFlightStatus = new Map<string, ReturnType<typeof getAssertionStatus>>();

export function getAssertionStatusShared(outputId: string): ReturnType<typeof getAssertionStatus> {
  const existing = inFlightStatus.get(outputId);
  if (existing) return existing;
  const promise = getAssertionStatus(outputId);
  inFlightStatus.set(outputId, promise);
  const clear = () => {
    if (inFlightStatus.get(outputId) === promise) inFlightStatus.delete(outputId);
  };
  promise.then(clear, clear);
  return promise;
}
