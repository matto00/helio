import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchPanelPage } from "../state/panelsSlice";
import { CROSS_FILTER_EQ_REJECTED } from "../state/panelThunks";
import { getOutputId } from "../state/panelNarrowing";
import type {
  CrossFilterEq,
  MappedPanelData,
  Panel,
  PanelLastQuery,
  SelectionDescriptor,
} from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type {
  OutputRowsFilter,
  OutputRowsFilterOp,
  OutputRowsSort,
} from "../../pipelines/services/outputService";

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
  /** HEL-1351 design D2 — the loaded row RECORDS `rawRows` is derived from (typed values, `null`
   *  kept), for an aggregated chart Output to group client-side. `null` while nothing is loaded. */
  paginationRows?: Record<string, unknown>[] | null;
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
 *  (`GET /api/outputs/:id/rows`). Non-output panels never fetch.
 *
 *  HEL-1190 design.md D3/D4 (task 5.3) — `controlFilterOps`, when passed, composes into every
 *  dispatch this hook makes and is folded into the fetch-DEDUPLICATION key itself, so a control
 *  change (not just an output-id change) is treated as needing a fresh fetch. Used directly by
 *  `PanelDetailModal` (which has no sibling `usePanelSortFilter` layering to piggyback on, unlike
 *  `PanelCardBody`'s desktop-grid/mobile-stack path — see that hook's own doc comment for why
 *  composition happens THERE instead for that path). Defaults to `[]` so every pre-existing call
 *  site (none of which passed a 2nd arg) keeps compiling and behaving identically.
 *
 *  HEL-1191 design.md D9a-i/D9a-ii — `crossFilterEq` is the dashboard cross-filter's server-side
 *  `eq` term, a SEPARATE parameter (never concatenated into `controlFilterOps`, C4) that joins the
 *  fetch key and every dispatch. When NEITHER explicit argument is given (the ops-less hosts
 *  `PanelCard`/`MobilePanelStack`, which own no Output), the mount dispatch and `refresh()` REPLAY
 *  the panel's own `paginationState.lastQuery` instead of dispatching an unfiltered read that
 *  would silently drop a server-applied filter/sort — see `replayableQuery` below for the rules. */
export function usePanelData(
  panel: Panel,
  controlFilterOps: OutputRowsFilterOp[] = [],
  crossFilterEq: CrossFilterEq | null = null,
): PanelDataResult {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);
  const activeCrossFilter = useAppSelector((state) => state.panels.crossFilter);

  const outputId = getOutputId(panel);
  const controlFilterOpsKey = controlFilterOps.length > 0 ? JSON.stringify(controlFilterOps) : "";
  const crossFilterEqKey = crossFilterEq ? JSON.stringify(crossFilterEq) : "";
  const currentFetchKey = outputId
    ? panel.id + "|" + outputId + "|" + controlFilterOpsKey + "|" + crossFilterEqKey
    : null;

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
  const replayFullQueryRef = useRef(false);

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    prevFetchKey.current = null;
    // design.md D9a-i/C4 — a refresh (manual/poll/SSE) replays the FULL last query; a plain
    // mount/remount replays only the URL/Redux-held terms (see `replayableQuery`).
    replayFullQueryRef.current = true;
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

    // An explicit argument (the detail modal's) takes precedence; otherwise replay the last query.
    const explicit = controlFilterOpsKey !== "" || crossFilterEq !== null;
    const fullReplay = replayFullQueryRef.current;
    replayFullQueryRef.current = false;
    const replay = explicit
      ? null
      : replayableQuery(
          paginationEntry?.lastQuery,
          outputId,
          panel.id,
          activeCrossFilter,
          fullReplay,
        );

    void dispatch(
      fetchPanelPage({
        panelId: panel.id,
        outputId,
        page: 0,
        pageSize: 200,
        sort: replay?.sort,
        filter: explicit
          ? controlFilterOpsKey
            ? { ops: controlFilterOps }
            : undefined
          : replay?.filter,
        crossFilterEq: explicit ? crossFilterEq : (replay?.crossFilterEq ?? null),
      }),
    )
      .unwrap()
      .then(() => {
        setErrorForKey((prev) => (prev?.key === keyAtDispatch ? null : prev));
      })
      .catch((err: { message?: string; kind?: RequestErrorKind; code?: string } | undefined) => {
        // design.md D3a — a rejected cross-filter `eq` is self-healing, never an error state.
        // An EXPLICIT `crossFilterEq` (the detail modal's) heals through its own fetch key (the
        // mode flips, the key changes, the effect refetches). A REPLAYED one has no key change
        // to ride on, so retry the same replay WITHOUT the `eq` right here — otherwise the panel
        // would keep the stale server-narrowed window that was on screen.
        if (err?.code === CROSS_FILTER_EQ_REJECTED) {
          if (!explicit) {
            void dispatch(
              fetchPanelPage({
                panelId: panel.id,
                outputId,
                page: 0,
                pageSize: 200,
                sort: replay?.sort,
                filter: replay?.filter,
                crossFilterEq: null,
              }),
            );
          }
          return;
        }
        setErrorForKey({
          key: keyAtDispatch,
          message: err?.message ?? "Failed to load data.",
          kind: err?.kind ?? "error",
        });
      })
      .finally(() => {
        inFlightRef.current = false;
      });
    // `crossFilterEq`/`activeCrossFilter`/`paginationEntry.lastQuery` are read fresh from the
    // closure on every run; `crossFilterEqKey` (via `currentFetchKey`) is the change trigger.
    // `controlFilterOps` itself is intentionally excluded — `controlFilterOpsKey` (already a
    // dependency via `currentFetchKey`) is the stable proxy for it; the array is read fresh from
    // the closure on every re-run `currentFetchKey`'s change triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      paginationRows: null,
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
    paginationRows: rows.length > 0 ? rows : null,
    rowsTruncated: paginationEntry?.hasMore ?? false,
    refresh,
    isRefreshing,
  };
}

/** design.md D9a-i — the query an ops-less host may replay from `paginationState.lastQuery`:
 *  (0) a refresh replays the whole query, a mount only the terms that outlive the component;
 *  (1) only when it was recorded for the panel's CURRENT Output (`paginationState` is keyed by
 *  panel and is not reset on a rebind); (2) its `crossFilterEq` only while it still equals the
 *  live `state.panels.crossFilter` (and this panel isn't the originating one) — a cross-filter
 *  cleared or changed while the panel was unmounted must never replay a stale `eq`. */
function replayableQuery(
  lastQuery: PanelLastQuery | undefined,
  outputId: string,
  panelId: string,
  activeCrossFilter: SelectionDescriptor | null,
  full: boolean,
): {
  sort?: OutputRowsSort;
  filter?: OutputRowsFilter;
  crossFilterEq: CrossFilterEq | null;
} | null {
  if (!lastQuery || lastQuery.outputId !== outputId) return null;
  const eq = lastQuery.crossFilterEq;
  const stillActive =
    eq !== null &&
    activeCrossFilter !== null &&
    activeCrossFilter.panelId !== panelId &&
    activeCrossFilter.dimension === eq.column &&
    activeCrossFilter.value === eq.value;
  if (full) {
    return {
      sort: lastQuery.sort,
      filter: lastQuery.filter,
      crossFilterEq: stillActive ? eq : null,
    };
  }
  // A mount/remount: the table's own sort/column-filter live in `usePanelSortFilter`'s local state,
  // which does NOT survive a remount (it re-seeds from the Output's persisted defaults), so
  // replaying them would desync the rows from the remounted table's controls. Only the terms held
  // OUTSIDE component state (viewer-control ops in the URL, the Redux cross-filter) replay.
  const controlOps = lastQuery.filter?.ops;
  return {
    filter: controlOps && controlOps.length > 0 ? { ops: controlOps } : undefined,
    crossFilterEq: stillActive ? eq : null,
  };
}
