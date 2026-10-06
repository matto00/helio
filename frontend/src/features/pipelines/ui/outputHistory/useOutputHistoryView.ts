import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchHistoryPointRows,
  fetchOutputHistory,
  type HistoryPoint,
} from "../../../panels/history/outputHistoryService";
import type { HistoryRow } from "../../utils/diffRows";

/** HEL-1277 design D2 — the scrubber reads up to this many of the newest points. */
export const HISTORY_VIEW_LIMIT = 100;

export type PointRowsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: HistoryRow[] };

export type HistoryLoadState = "loading" | "error" | "ready";

export interface OutputHistoryView {
  loadState: HistoryLoadState;
  /** Newest first. */
  points: HistoryPoint[];
  /** Index into `points` (0 = newest). */
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  selected: HistoryPoint | null;
  /** The next-older retained point, or `null` for the oldest. */
  comparison: HistoryPoint | null;
  /** The stored-rows state of `point`, or `undefined` when it has none to load (no payload). */
  rowsOf: (point: HistoryPoint | null) => PointRowsState | undefined;
}

/** HEL-1277 design D2/D6 — the History view's own fetch (never the shared dashboard cache: a
 *  100-point read would change the 30-point sparklines), the selection, and a per-view payload
 *  memo. A payload response lands in a map keyed by point id, so one for a point that is no longer
 *  selected can never render as the selected point's rows. A missing payload is `undefined`, never
 *  an empty row set. */
export function useOutputHistoryView(outputId: string): OutputHistoryView {
  const [loadState, setLoadState] = useState<HistoryLoadState>("loading");
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [payloads, setPayloads] = useState<Record<string, PointRowsState>>({});
  const started = useRef(new Set<string>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    started.current = new Set();
    fetchOutputHistory(outputId, { limit: HISTORY_VIEW_LIMIT }).then(
      (history) => {
        if (cancelled) return;
        setPoints(history.points);
        setSelectedIndex(0);
        setLoadState("ready");
      },
      () => {
        if (!cancelled) setLoadState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  const selected = points[selectedIndex] ?? null;
  const comparison = points[selectedIndex + 1] ?? null;

  const ensureRows = useCallback(
    (point: HistoryPoint | null) => {
      if (!point || point.hasPayload !== true || !point.id) return;
      const pointId = point.id;
      if (started.current.has(pointId)) return;
      started.current.add(pointId);
      fetchHistoryPointRows(outputId, pointId).then(
        (res) => {
          if (!mounted.current) return;
          setPayloads((prev) => ({ ...prev, [pointId]: { status: "ready", rows: res.rows } }));
        },
        () => {
          // Allow a re-selection to retry; the failure itself is shown, never read as "removed".
          started.current.delete(pointId);
          if (!mounted.current) return;
          setPayloads((prev) => ({ ...prev, [pointId]: { status: "error" } }));
        },
      );
    },
    [outputId],
  );

  useEffect(() => {
    ensureRows(selected);
    ensureRows(comparison);
  }, [selected, comparison, ensureRows]);

  const rowsOf = useCallback(
    (point: HistoryPoint | null): PointRowsState | undefined => {
      if (!point || point.hasPayload !== true || !point.id) return undefined;
      return payloads[point.id] ?? { status: "loading" };
    },
    [payloads],
  );

  return { loadState, points, selectedIndex, setSelectedIndex, selected, comparison, rowsOf };
}
