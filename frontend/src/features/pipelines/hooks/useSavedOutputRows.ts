import { useEffect, useSyncExternalStore } from "react";

import { getOutputRows } from "../services/outputService";

/**
 * HEL-1632 (design.md D5): an Output's saved rows, read only when the live column cannot render the node (not
 * previewed, no usable sample). One `GET /api/outputs/:id/rows` per Output per page load; a run that settles clears the
 * cache so the next read is the new run's. A failed read is remembered as `error` (no retry loop).
 */
export type SavedRowsState =
  | { status: "loading" }
  | { status: "ready"; rows: Record<string, unknown>[] }
  | { status: "error" };

// The rows route clamps `limit` to its page maximum (500), so one read is the first page, as a panel loads.
const SAVED_ROW_LIMIT = 500;
const cache = new Map<string, SavedRowsState>();
const listeners = new Set<() => void>();
let version = 0;

const notify = () => {
  version += 1;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Forget every saved read (a run settled, or the page unmounted). */
export function clearSavedOutputRows(): void {
  if (cache.size === 0) return;
  cache.clear();
  notify();
}

function load(outputId: string): void {
  cache.set(outputId, { status: "loading" });
  Promise.resolve(getOutputRows(outputId, 0, SAVED_ROW_LIMIT)).then(
    (result) => {
      if (cache.get(outputId)?.status !== "loading") return;
      cache.set(outputId, { status: "ready", rows: result?.items ?? [] });
      notify();
    },
    () => {
      if (cache.get(outputId)?.status !== "loading") return;
      cache.set(outputId, { status: "error" });
      notify();
    },
  );
}

export function useSavedOutputRows(
  outputId: string | null,
  enabled: boolean,
): SavedRowsState | null {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (enabled && outputId !== null && !cache.has(outputId)) load(outputId);
  });
  if (!enabled || outputId === null) return null;
  return cache.get(outputId) ?? { status: "loading" };
}
