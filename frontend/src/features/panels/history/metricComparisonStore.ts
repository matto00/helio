/** HEL-1275 design.md D5 — hands the comparison a metric panel resolved to its provenance popover
 *  without new props at the six `ProvenanceTrigger` call sites. `OutputPanelContent` publishes
 *  `{ baselineAt, baselineText }` (or `null` whenever the delta is hidden) keyed
 *  `<variant>:<panelId>`; each publisher has its own slot so the card and the fullscreen overlay of
 *  one panel never clobber each other's cleanup, and readers take the most recent live publisher. */
export interface PublishedComparison {
  baselineAt: string;
  baselineText: string;
}

const slots = new Map<string, Map<symbol, PublishedComparison | null>>();
const listeners = new Set<() => void>();

export function comparisonStoreKey(variant: string, panelId: string): string {
  return `${variant}:${panelId}`;
}

function notify(): void {
  listeners.forEach((l) => l());
}

export function publishComparison(
  key: string,
  publisher: symbol,
  value: PublishedComparison | null,
): void {
  let bucket = slots.get(key);
  if (!bucket) {
    bucket = new Map();
    slots.set(key, bucket);
  }
  // Delete-then-set moves this publisher to the end: Map order is publish recency.
  bucket.delete(publisher);
  bucket.set(publisher, value);
  notify();
}

export function unpublishComparison(key: string, publisher: symbol): void {
  const bucket = slots.get(key);
  if (!bucket) return;
  bucket.delete(publisher);
  if (bucket.size === 0) slots.delete(key);
  notify();
}

export function getPublishedComparison(key: string): PublishedComparison | null {
  const bucket = slots.get(key);
  if (!bucket) return null;
  const last = Array.from(bucket.values()).pop();
  return last ?? null;
}

export function subscribeComparisons(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam. */
export function resetComparisonStore(): void {
  slots.clear();
  listeners.clear();
}
