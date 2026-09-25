import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchPanelPage } from "../state/panelsSlice";
import { getOutputId } from "../state/panelNarrowing";
import type { MappedPanelData, Panel } from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { RequestErrorKind } from "../../../services/classifyRequestError";

export interface PanelDataResult {
  data: MappedPanelData | null;
  rawRows: string[][] | null;
  headers: string[] | null;
  isLoading: boolean;
  error: string | null;
  /** Classification of `error` — `null` when there is no error. */
  errorKind: RequestErrorKind | null;
  noData: boolean;
  /** HEL-946 Bug C(2): true when `noData` is caused by the bound Output's
   *  node never having been materialized by a successful pipeline run, as
   *  opposed to a node that ran and legitimately returned zero rows.
   *  Always `false` while `noData` is `false`. */
  neverMaterialized: boolean;
  /** HEL-451 design D4: whether MORE rows exist upstream than are currently
   *  loaded (`paginationEntry?.hasMore`) — branch-independent, unlike
   *  `usingPagination && paginationHasMore` (HEL-448's original predicate),
   *  which is derived from props a `rawRows`-only caller never receives.
   *  Both `rawRows` and any pagination props below are derived from this
   *  SAME `paginationEntry`, so this is true on either branch. See
   *  `PanelDetailModal.tsx`/`PanelCard.tsx`'s `rowsTruncated` wiring. */
  rowsTruncated: boolean;
  /** Retained for renderer-compatibility during the HEL-909 migration; the
   *  Output itself now owns any groupBy aggregation, so this is always
   *  `null`. */
  chartAggregate: null;
  /** Reset the fetch-deduplication key and trigger a fresh data fetch. A
   *  no-op while a fetch for the current key is already in flight (design.md
   *  D2) — guards the manual-refresh, poll, and SSE-fan-out callers uniformly
   *  since all three ultimately call this same closure. */
  refresh: () => void;
  /** HEL-579 design.md D3: true while ANY fetch (first load or refresh) is
   *  pending for `paginationEntry`. Distinct from `isLoading`, which stays
   *  `false` once a panel has data — `isLoading` gates the full skeleton,
   *  this gates the Refresh control's spinner so a refresh of already-loaded
   *  data never re-triggers the skeleton. */
  isRefreshing: boolean;
}

/** Fetches rows for an output-kind panel's bound Output
 *  (`GET /api/outputs/:id/rows`). Non-output panels never fetch. */
export function usePanelData(panel: Panel): PanelDataResult {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);

  const outputId = getOutputId(panel);
  const currentFetchKey = outputId ? panel.id + "|" + outputId : null;

  const prevFetchKey = useRef<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [errorForKey, setErrorForKey] = useState<{
    key: string;
    message: string;
    kind: RequestErrorKind;
  } | null>(null);

  // HEL-579 design.md D2: mutated SYNCHRONOUSLY INLINE at the two points this
  // hook actually starts/settles a fetch -- never mirrored from Redux state
  // via a second `useEffect`, which would lag the real dispatch by a full
  // render-plus-passive-effect-flush cycle and fail to close a same-tick
  // double-activation race. This is the single guard shared by all three
  // `refresh()` callers (manual button, `usePanelPolling`, and the HEL-1094
  // SSE fan-out) -- one `usePanelData` instance per panel, so one ref covers
  // all three uniformly.
  const inFlightRef = useRef(false);

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    prevFetchKey.current = null;
    setErrorForKey(null);
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!currentFetchKey || !outputId) {
      // Losing the Output binding mid-fetch must not wedge the guard `true`
      // for a hook instance that could later be rebound to a new Output.
      inFlightRef.current = false;
      return;
    }

    if (prevFetchKey.current === currentFetchKey && paginationEntry != null) {
      return;
    }
    prevFetchKey.current = currentFetchKey;

    // Covers the initial mount / output-changed dispatch too, which never
    // goes through `refresh()` at all.
    inFlightRef.current = true;
    const keyAtDispatch = currentFetchKey;

    void dispatch(fetchPanelPage({ panelId: panel.id, outputId, page: 0, pageSize: 200 }))
      .unwrap()
      .then(() => {
        setErrorForKey((prev) => (prev?.key === keyAtDispatch ? null : prev));
      })
      .catch((err: { message?: string; kind?: RequestErrorKind } | undefined) => {
        setErrorForKey({
          key: keyAtDispatch,
          message: err?.message ?? "Failed to load data.",
          kind: err?.kind ?? "error",
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [currentFetchKey, outputId, panel.id, dispatch, refreshToken, paginationEntry]);

  const rows = useMemo(() => paginationEntry?.rows ?? [], [paginationEntry]);

  const headers = useMemo(
    () => (rows.length > 0 ? Object.keys(rows[0]).map(String) : null),
    [rows],
  );

  const rawRows = useMemo(
    () =>
      rows.length > 0
        ? rows.map((row) =>
            Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")),
          )
        : null,
    [rows],
  );

  if (!currentFetchKey) {
    return {
      data: null,
      rawRows: null,
      headers: null,
      isLoading: false,
      error: null,
      errorKind: null,
      noData: false,
      neverMaterialized: false,
      chartAggregate: null,
      rowsTruncated: false,
      refresh,
      isRefreshing: false,
    };
  }

  const error = errorForKey?.key === currentFetchKey ? errorForKey.message : null;
  const errorKind = errorForKey?.key === currentFetchKey ? errorForKey.kind : null;
  const isLoading =
    paginationEntry == null || (paginationEntry.isLoadingMore === true && rows.length === 0);
  const noData =
    paginationEntry != null && !paginationEntry.isLoadingMore && rows.length === 0 && !error;
  // HEL-946 Bug C(2) -- defaults to `true` (materialized) before the fetch
  // resolves, so `neverMaterialized` never fires spuriously while loading;
  // `paginationEntry.materialized` only becomes meaningful once `noData` is
  // also true.
  const neverMaterialized = noData && paginationEntry?.materialized === false;
  const isRefreshing = paginationEntry?.isLoadingMore ?? false;

  return {
    data: null,
    rawRows,
    headers,
    isLoading,
    error,
    errorKind,
    noData,
    neverMaterialized,
    chartAggregate: null,
    rowsTruncated: paginationEntry?.hasMore ?? false,
    refresh,
    isRefreshing,
  };
}
