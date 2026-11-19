import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useStore } from "react-redux";

import { fetchPanelPage } from "../state/panelsSlice";
import { CROSS_FILTER_EQ_REJECTED } from "../state/panelThunks";
import { getOutputId } from "../state/panelNarrowing";
import { getKnownOutputKind } from "../state/outputMetaCache";
import { isPendingFor, isReusable, type RowsQuery } from "../state/panelRowsReuse";
import type {
  CrossFilterEq,
  MappedPanelData,
  Panel,
  PanelLastQuery,
  SelectionDescriptor,
} from "../types/panel";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import type { RootState } from "../../../store/store";
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type {
  OutputRowsFilter,
  OutputRowsFilterOp,
  OutputRowsSort,
} from "../../pipelines/services/outputService";
import { recordsToPanelRows } from "../ui/outputRenderInputs";

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
  /** HEL-1705 H — the window's column order (the Output's schema names, then other keys by code point); absent for a window
   *  with none (an older server or warm copy), which renders as before. */
  columns?: string[];
  /** Reset the fetch-deduplication key and trigger a fresh data fetch. A
   *  no-op while a fetch for the current key is already in flight (design.md
   *  D2) — guards the manual-refresh, poll, and SSE-fan-out callers uniformly
   *  since all three ultimately call this same closure. */
  refresh: () => void;
  /** HEL-1738: like `refresh`, but a call made while a request is in flight queues exactly ONE refresh,
   *  sent once that request settles (repeat calls coalesce), instead of being dropped. With nothing in
   *  flight it is `refresh`. `isRefreshing` stays true from the queueing until the queued request
   *  settles. Always supplied by `usePanelData`. Used only by the dashboard refresh round; poll, SSE and the per-panel control keep `refresh`. */
  queueRefresh: () => void;
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
export interface UsePanelDataOptions {
  /** HEL-1392 design.md D2 — set by the host card's child (`usePanelSortFilter`) when it owns the
   *  mount's page-0 request (it has a persisted sort/filter default, a URL control op or a
   *  cross-filter term to apply). This hook then makes no mount request of its own. Only the
   *  ops-less hosts (`PanelCard`, the phone stack) pass it; `PanelDetailModal` never does. */
  mountOwnership?: RefObject<boolean>;
}

export function usePanelData(
  panel: Panel,
  controlFilterOps: OutputRowsFilterOp[] = [],
  crossFilterEq: CrossFilterEq | null = null,
  options: UsePanelDataOptions = {},
): PanelDataResult {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const { mountOwnership } = options;
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);
  const activeCrossFilter = useAppSelector((state) => state.panels.crossFilter);

  const outputId = getOutputId(panel);
  // HEL-1744 D7 -- an `insight` Output has no rows to show (its panel reads the stored render), so once its kind is known no rows
  // are requested: not on a warm remount, and not after a run completes (the kind outlives the invalidated metadata). A cold first
  // load cannot know the kind before the metadata arrives, and waiting for it would delay every other panel's rows, so that one
  // first request is still made (measured: exactly one per insight panel) and its result ignored.
  const isInsightOutput = outputId !== null && getKnownOutputKind(outputId) === "insight";
  const controlFilterOpsKey = controlFilterOps.length > 0 ? JSON.stringify(controlFilterOps) : "";
  const crossFilterEqKey = crossFilterEq ? JSON.stringify(crossFilterEq) : "";
  const currentFetchKey =
    outputId && !isInsightOutput
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
  // HEL-1392 design.md D2/D8 — set when this mount's first decision was "the child owns the
  // request"; the effect's re-run for the same key and refresh token (StrictMode's dev double run,
  // or a render that has not yet seen the entry) must not send the stripped query after all.
  const ownershipSkippedKey = useRef<{ key: string; token: number } | null>(null);

  // HEL-1738 design D2 -- the one queued refresh. `queuedRef` is the synchronous truth (repeat calls
  // are no-ops); `queued` mirrors it for `isRefreshing` and is cleared only right after the queued
  // dispatch (never at drain time) so `isRefreshing` has no false gap between the two requests.
  const queuedRef = useRef(false);
  const mountedRef = useRef(false);
  // The latest request THIS hook dispatched; a newer `latestFetchRequestId` that differs is someone else's (a sort/filter refetch, load-more, the detail modal).
  const ownRequestIdRef = useRef<string | null>(null);
  const [queued, setQueued] = useState(false);

  const startRefresh = useCallback(() => {
    inFlightRef.current = true;
    prevFetchKey.current = null;
    // design.md D9a-i/C4 — a refresh (manual/poll/SSE) replays the FULL last query; a plain
    // mount/remount replays only the URL/Redux-held terms (see `replayableQuery`).
    replayFullQueryRef.current = true;
    setErrorForKey(null);
    setRefreshToken((t) => t + 1);
  }, []);

  const refresh = useCallback(() => {
    if (inFlightRef.current) return;
    startRefresh();
  }, [startRefresh]);

  const queueRefresh = useCallback(() => {
    if (!inFlightRef.current) {
      startRefresh();
      return;
    }
    queuedRef.current = true;
    setQueued(true);
  }, [startRefresh]);

  // Called wherever `inFlightRef` falls to false: sends the queued refresh, if any, synchronously
  // (so `inFlightRef` is true again before any other caller can enter).
  const drain = useCallback(() => {
    if (!queuedRef.current || !mountedRef.current) return;
    queuedRef.current = false;
    startRefresh();
  }, [startRefresh]);

  const dropQueued = useCallback(() => {
    queuedRef.current = false;
    setQueued(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queuedRef.current = false;
    };
  }, []);

  // HEL-1392 design.md D2/D8 (N2/N3) -- waits, without dispatching, for a request somebody else
  // owns: holds the refresh guard until the entry settles, and surfaces THAT request's failure (a
  // later, unrelated one -- e.g. a user-driven sort refetch -- is the toast's business, not ours).
  // The subscription is tied to the component's mount (below), so an unmounted card never
  // receives a late `setState`; `waitRecord` lets StrictMode's cleanup/re-run resume it.
  const waitRecord = useRef<{ key: string; waitedId: string | undefined } | null>(null);
  const unsubscribeWait = useRef<(() => void) | null>(null);

  const subscribeWait = useCallback(
    (record: { key: string; waitedId: string | undefined }) => {
      const settled = () => {
        const entry = store.getState().panels.paginationState[panel.id];
        return !entry || !entry.isLoadingMore ? entry : null;
      };
      if (settled() !== null) {
        // No drain: this runs synchronously on mount, before any `queueRefresh()` can exist (design.md D2).
        waitRecord.current = null;
        inFlightRef.current = false;
        return;
      }
      inFlightRef.current = true;
      const unsubscribe = store.subscribe(() => {
        const entry = settled();
        if (entry === null) return;
        unsubscribe();
        unsubscribeWait.current = null;
        waitRecord.current = null;
        inFlightRef.current = false;
        drain();
        if (entry?.lastError && entry.lastError.requestId === record.waitedId) {
          const { message, kind } = entry.lastError;
          setErrorForKey({ key: record.key, message, kind });
        }
      });
      unsubscribeWait.current = unsubscribe;
    },
    [store, panel.id, drain],
  );

  const waitForOwnedRequest = useCallback(
    (key: string) => {
      const record = { key, waitedId: store.getState().panels.latestFetchRequestId[panel.id] };
      waitRecord.current = record;
      subscribeWait(record);
    },
    [store, panel.id, subscribeWait],
  );

  useEffect(() => {
    if (waitRecord.current && unsubscribeWait.current === null) subscribeWait(waitRecord.current);
    return () => {
      unsubscribeWait.current?.();
      unsubscribeWait.current = null;
    };
  }, [subscribeWait]);

  useEffect(() => {
    if (!currentFetchKey || !outputId) {
      // Losing the Output binding mid-fetch must not wedge the guard `true`
      // for a hook instance that could later be rebound to a new Output.
      inFlightRef.current = false;
      dropQueued();
      return;
    }

    // N1 -- precedes every other check, and clears only on the RENDER-CAPTURED entry (the live
    // store would show the owner's pending entry on StrictMode's re-run and re-open the door to
    // the stripped query).
    const skipped = ownershipSkippedKey.current;
    if (skipped !== null) {
      if (skipped.key === currentFetchKey && skipped.token === refreshToken) {
        if (paginationEntry == null) return;
      }
      ownershipSkippedKey.current = null;
    }

    if (prevFetchKey.current === currentFetchKey && paginationEntry != null) {
      return;
    }
    const isFirstMountDecision = prevFetchKey.current === null && !replayFullQueryRef.current;
    prevFetchKey.current = currentFetchKey;

    // An explicit argument (the detail modal's) takes precedence; otherwise replay the last query.
    const explicit = controlFilterOpsKey !== "" || crossFilterEq !== null;
    const fullReplay = replayFullQueryRef.current;
    replayFullQueryRef.current = false;
    const liveEntry = store.getState().panels.paginationState[panel.id];
    const replay = explicit
      ? null
      : replayableQuery(liveEntry?.lastQuery, outputId, panel.id, activeCrossFilter, fullReplay);

    // HEL-1392 -- a refresh (manual, poll, SSE) always fetches. Anything else first asks whether
    // the window already held, or the request already in flight, is exactly what would be sent.
    if (!fullReplay) {
      if (isFirstMountDecision && mountOwnership?.current && liveEntry) {
        ownershipSkippedKey.current = { key: currentFetchKey, token: refreshToken };
        waitForOwnedRequest(currentFetchKey);
        return;
      }
      const query: RowsQuery = {
        outputId,
        sort: replay?.sort,
        filter: explicit
          ? controlFilterOpsKey
            ? { ops: controlFilterOps }
            : undefined
          : replay?.filter,
        crossFilterEq: explicit ? crossFilterEq : (replay?.crossFilterEq ?? null),
      };
      if (isReusable(liveEntry, query)) {
        // No drain (design.md D2): a reusable window means no request is pending, and the only way a
        // queue exists is behind an in-flight request whose own settlement (`.finally`) drains it.
        inFlightRef.current = false;
        return;
      }
      if (isPendingFor(liveEntry, query)) {
        waitForOwnedRequest(currentFetchKey);
        return;
      }
    }

    // Covers the initial mount / output-changed dispatch too, which never
    // goes through `refresh()` at all.
    inFlightRef.current = true;
    const keyAtDispatch = currentFetchKey;

    const request = dispatch(
      fetchPanelPage({
        panelId: panel.id,
        dashboardId: panel.dashboardId,
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
    );
    // HEL-1738 D3 -- the queued refresh's request is now pending (`isLoadingMore` true), so the
    // `queued` bridge is no longer needed.
    if (!queuedRef.current) setQueued(false);
    // The request whose settlement may drain the queue: this one, or the CROSS_FILTER retry below.
    let lastRequestId = request.requestId;
    ownRequestIdRef.current = lastRequestId;
    void request
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
            const retry = dispatch(
              fetchPanelPage({
                panelId: panel.id,
                dashboardId: panel.dashboardId,
                outputId,
                page: 0,
                pageSize: 200,
                sort: replay?.sort,
                filter: replay?.filter,
                crossFilterEq: null,
              }),
            );
            lastRequestId = retry.requestId;
            ownRequestIdRef.current = lastRequestId;
            // Returned so `.finally` (guard release + queue drain) waits for the retry to settle.
            return retry;
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
        if (!queuedRef.current) return;
        const state = store.getState().panels;
        const latest = state.latestFetchRequestId[panel.id];
        // Never send the queued refresh over a newer pending request. Our own newer request (an Output
        // rebind) drains at its own settlement. A request this hook did not send (a sort/filter refetch,
        // load-more, the detail modal) has no finally of ours: hand the queue to it and drain when it settles.
        if (latest === lastRequestId) drain();
        else if (latest !== ownRequestIdRef.current) {
          if (state.paginationState[panel.id]?.isLoadingMore) {
            subscribeWait({ key: keyAtDispatch, waitedId: undefined });
          } else drain();
        }
      });
    // `crossFilterEq`/`activeCrossFilter`/`paginationEntry.lastQuery` are read fresh from the
    // closure on every run; `crossFilterEqKey` (via `currentFetchKey`) is the change trigger.
    // `controlFilterOps` itself is intentionally excluded — `controlFilterOpsKey` (already a
    // dependency via `currentFetchKey`) is the stable proxy for it; the array is read fresh from
    // the closure on every re-run `currentFetchKey`'s change triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFetchKey, outputId, panel.id, dispatch, refreshToken, paginationEntry]);

  const rows = useMemo(() => paginationEntry?.rows ?? [], [paginationEntry]);

  const columns = paginationEntry?.columns;
  const { headers, rawRows } = useMemo(() => recordsToPanelRows(rows, columns), [rows, columns]);

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
      queueRefresh,
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
  // HEL-1738 D3 -- `queued` bridges the gap between the in-flight request settling and the queued one pending.
  const isRefreshing = (paginationEntry?.isLoadingMore ?? false) || queued;

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
    columns,
    rowsTruncated: paginationEntry?.hasMore ?? false,
    refresh,
    queueRefresh,
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
