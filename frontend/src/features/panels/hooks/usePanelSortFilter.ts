import { useCallback, useEffect, useRef, useState } from "react";

import { fetchPanelPage } from "../state/panelsSlice";
import { CROSS_FILTER_EQ_REJECTED } from "../state/panelThunks";
import type { CrossFilterEq } from "../types/panel";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import { readTableConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import type { TableColumnFilters } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { isFiltering } from "../ui/renderers/tableFilterPredicate";
import type { SortDirection, SortState } from "../../../shared/ui/useSortedRows";
import type { Output } from "../../pipelines/types/output";
import { composeOutputRowsFilter } from "../../pipelines/services/outputService";
import type { OutputRowsFilterOp } from "../../pipelines/services/outputService";

/** HEL-1027 skeptic-final-1.md CR1 — debounces the SERVER refetch a sort/filter change triggers,
 *  separate from (and unrelated to) `TableRenderer`'s own `canWrite`-gated persist-as-default
 *  debounce (`PERSIST_DEBOUNCE_MS`, a different concern entirely). Matches that constant's value
 *  for consistency, not because the two are coupled. */
const REFETCH_DEBOUNCE_MS = 300;

export interface PanelSortFilterResult {
  /** HEL-1027 design.md D10 (task 4.7) — whether a table filter is genuinely active right now
   *  (either seeded from the Output's persisted default, or set by a real user edit this
   *  session), reusing `tableFilterPredicate.ts`'s existing `isFiltering`. */
  filterActive: boolean;
  /** The current sort/filter, exposed so a caller's OWN "Load more" (page > 0) dispatch can carry
   *  them too — `page`, unlike a sort/filter CHANGE, never resets to 0, so it is `PanelCardBody.tsx`'s
   *  own job to read these and include them, not this hook's (task 4.3's reset-then-refetch is
   *  page-0-only by construction). */
  activeSort: SortState<string> | null;
  activeFilter: TableColumnFilters | null;
  /** Wired to `TableRenderer`'s new `onSortChange` prop — fires from the UNCONDITIONAL first
   *  half of that component's own `handleSort` (alongside its local `toggleSort`), so it runs for
   *  every caller regardless of `canWrite` (design.md D4). */
  handleSortChange: (column: string, direction: SortDirection | null) => void;
  /** Wired to `TableRenderer`'s new `onFilterChange` prop — same unconditional-first-half
   *  contract as `handleSortChange` above. */
  handleFilterChange: (filters: TableColumnFilters) => void;
}

/** HEL-1027 design.md D4/D10 (tasks 4.1-4.3, 4.7), revised per skeptic-final-1.md (round 1,
 *  REFUTE) — owns the AUTHORITATIVE sort/filter state for a table-kind output panel's
 *  server-side round trip, lifted out of `TableRenderer`'s own local `useState` (which still
 *  separately owns its own copy of the CURRENT value, for immediate per-keystroke/per-click UI
 *  responsiveness — this hook is never in that render-critical path).
 *
 *  **skeptic-final-1.md Defect 1 fix.** The SERVER refetch a sort/filter change triggers is now
 *  DEBOUNCED (`REFETCH_DEBOUNCE_MS`), separate from `TableRenderer`'s local, unconditional
 *  `setFilters`/`onFilterChange` calls (which still fire on every keystroke, unchanged — that is
 *  what makes typing feel instant). Previously, an undebounced `dispatch(resetPanelPagination(...))`
 *  fired on EVERY keystroke, hard-`delete`-ing the panel's pagination entry; that flipped
 *  `usePanelData.isLoading` back to `true` (its `rows.length === 0` branch), which unmounted
 *  `PanelContent`'s ENTIRE `TableRenderer` — including the filter textbox itself — into a loading
 *  skeleton mid-keystroke, silently dropping every character after the first. Fixed by (a)
 *  debouncing the dispatch itself, and (b) no longer calling `resetPanelPagination` at all: a
 *  page-0 `fetchPanelPage.pending` already keeps the PREVIOUSLY loaded rows visible
 *  (`existing?.rows ?? []`) while `isLoadingMore` (not `isLoading`) goes true — the same
 *  "refreshing, not reloading" signal `usePanelData.isRefreshing` already exposes elsewhere — so
 *  `TableRenderer` (and its filter input) stays mounted throughout, and `fetchPanelPage.fulfilled`
 *  still replaces `rows`/`total`/`hasMore` wholesale once the debounced request lands (AC #2's
 *  "no duplicated/dropped rows" is unaffected — a page-0 fulfillment REPLACES, never appends).
 *
 *  **skeptic-final-1.md Defect 2 fix lives in `panelsSlice.ts`** (`latestFetchRequestId`, CR2):
 *  this hook's dispatches are unchanged in shape, but the reducer now discards a response whose
 *  OWN dispatch is no longer the latest one recorded for the panel — closing the out-of-order
 *  race a debounce alone cannot close (a slow, STALE unfiltered response landing after a fast,
 *  correct filtered one).
 *
 *  `activeFilter`/`activeSort` are ALSO seeded once from `output.config`'s persisted
 *  `columnSort`/`columnFilters` defaults (`readTableConfig`), via a render-time "adjust state"
 *  block — so `filterActive` (task 4.7) is correct even before the user has touched the filter UI
 *  this session, and (task 7.3 live-UI finding) an EFFECT fires the same (undebounced — this is a
 *  one-time programmatic correction, not a keystroke stream) refetch once when that seeded
 *  default is itself genuinely active, so a persisted default is honored from first paint. NOTE:
 *  `output` here is a SEPARATE fetch (`PanelCard`'s own pre-existing `useOutputMeta(outputId)`,
 *  reused — not a new network call) than the one `TableRenderer`'s own seed uses (via
 *  `OutputPanelContent`'s independently-resolving `useOutputMeta`); both requests target the SAME
 *  Output and typically resolve within the same tick, but the two can theoretically settle one
 *  render apart. That window is bounded and purely cosmetic (at most one stale render of
 *  `filterActive`, never a wrong PERSISTED value) — the same class of accepted, precedented
 *  independent-refetch-of-the-same-Output tradeoff already documented on `usePanelCardInspect.ts`'s own
 *  `chartInspectConfig` `useOutputMeta` call. */
export function usePanelSortFilter(
  panelId: string,
  outputId: string | null,
  output: Output | null,
  // HEL-1190 design.md D3 (task 4.3) — the viewer's CURRENT control selection, already resolved
  // into `ops[]` entries by the caller (`buildViewerControlFilterOps`); this hook composes them
  // with its OWN in-panel `quick`/`columns` state on every dispatch (`composeOutputRowsFilter`)
  // rather than merging/deduping against them — neither this hook nor `useViewerControls` knows
  // about the other's existence beyond this one opaque parameter (design.md D3's own stated
  // shape). Defaults to `[]` so every pre-existing call site (none of which passed a 4th arg)
  // keeps compiling and behaving identically.
  controlFilterOps: OutputRowsFilterOp[] = [],
  // HEL-1191 design.md D9a-i/D9a-ii, C4 — the dashboard cross-filter's server-side `eq` term. A
  // SEPARATE input (never concatenated into `controlFilterOps`): it joins `dispatchFetch`'s args
  // (via a ref, like `controlFilterOps`), the corrective-mount condition and the change key, so
  // set / change / clear re-dispatches page 0 exactly like a control change does.
  crossFilterEq: CrossFilterEq | null = null,
): PanelSortFilterResult {
  const dispatch = useAppDispatch();
  const { push: pushToast } = useToast();
  const [activeSort, setActiveSort] = useState<SortState<string> | null>(null);
  const [activeFilter, setActiveFilter] = useState<TableColumnFilters | null>(null);

  // "Adjusting state when a prop changes" (react.dev) — seeds `activeSort`/`activeFilter` from
  // `output.config`'s persisted defaults the FIRST time `output` resolves for a given id, via a
  // conditional setState call during RENDER rather than inside a `useEffect` body (this repo's
  // `react-hooks/set-state-in-effect` rule flags the latter as an unnecessary-effect anti-pattern
  // for pure derived state). `seededOutputId` is itself `useState`-tracked (never a ref mutated
  // during render) so this stays a pure, StrictMode-safe render-time adjustment, not a side effect.
  const [seededOutputId, setSeededOutputId] = useState<string | null>(null);
  if (output && output.id !== seededOutputId) {
    setSeededOutputId(output.id);
    const cfg = readTableConfig(output.config);
    setActiveSort(cfg.columnSort ?? null);
    setActiveFilter(cfg.columnFilters ?? null);
  }

  // HEL-1190 design.md D3 — read via a ref (not a `dispatchFetch` dependency) so a new
  // `controlFilterOps` ARRAY identity every render (the caller's own `useMemo`, or a bare inline
  // array) never invalidates `dispatchFetch`'s/`handleSortChange`'s/`handleFilterChange`'s own
  // memoization — mirrors this codebase's established ref-for-latest-value-without-effect-re-run
  // convention (e.g. `TableRenderer.tsx`'s `pinnedCountRef`).
  const controlFilterOpsRef = useRef(controlFilterOps);
  controlFilterOpsRef.current = controlFilterOps;
  const crossFilterEqRef = useRef(crossFilterEq);
  crossFilterEqRef.current = crossFilterEq;

  const dispatchFetch = useCallback(
    (sort: SortState<string> | null, filter: TableColumnFilters | null) => {
      if (!outputId) return;
      void dispatch(
        fetchPanelPage({
          panelId,
          outputId,
          page: 0,
          pageSize: 200,
          sort: sort ? { column: sort.key, direction: sort.direction } : undefined,
          // HEL-1190 design.md D3 — ANDs the viewer's control selection in as separate `ops[]`
          // entries alongside whichever in-panel `quick`/`columns` term is already active.
          filter: composeOutputRowsFilter(filter, controlFilterOpsRef.current),
          crossFilterEq: crossFilterEqRef.current,
        }),
      )
        .unwrap()
        .catch((err: { message?: string; code?: string } | undefined) => {
          // HEL-1191 design.md D3a — a rejected cross-filter `eq` is self-healing (the mode
          // flips to client-fallback and the change key below refetches without it): no toast.
          if (err?.code === CROSS_FILTER_EQ_REJECTED) return;
          // HEL-1027 design.md D3 (task 4.6) — defense-in-depth: the UI already gates the
          // control that could produce a non-eligible sort/filter request (task 4.5), so this
          // path fires only for a genuinely stale client (a schema change mid-session) or a
          // transient network failure. Either way, never silent.
          pushToast({ variant: "error", message: err?.message ?? "Failed to apply sort/filter." });
        });
    },
    [dispatch, panelId, outputId, pushToast],
  );

  // HEL-1027 skeptic-final-1.md CR1 — the debounced entry point real user interaction
  // (`handleSortChange`/`handleFilterChange`) goes through; NOT used for the one-time
  // persisted-default correction below, which fires immediately (see that effect's own comment).
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedRefetch = useCallback(
    (sort: SortState<string> | null, filter: TableColumnFilters | null) => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        dispatchFetch(sort, filter);
      }, REFETCH_DEBOUNCE_MS);
    },
    [dispatchFetch],
  );

  // Cancel (never flush) a pending debounced refetch on unmount — unlike a WRITE (e.g.
  // `TableRenderer`'s own persist-as-default debounce), an abandoned READ has nothing worth
  // completing on behalf of a panel that's no longer mounted.
  useEffect(() => {
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    };
  }, []);

  // HEL-1027 live-UI-verification finding (task 7.3) — a REAL, user-visible defect the render-
  // time seed above alone does not fix: `usePanelData`'s OWN mount effect always fires an
  // unsorted/UNFILTERED page-0 fetch (unaware of any persisted default), so a table Output with a
  // genuinely active PERSISTED sort/filter (no user interaction yet this session) would otherwise
  // show that stale, raw-total fetch's count/order until the user manually touches a control --
  // live-reproduced as a table showing only its 3 "target"-filtered rows while its disclosure
  // still read "60 results." (the unfiltered total) on a fresh page load. Firing the SAME
  // `dispatchFetch` a real interaction eventually reaches, but immediately (never debounced —
  // this is a one-time programmatic correction, not a keystroke stream) and from an EFFECT (a
  // genuine side effect synchronizing with the server once a persisted default is known) rather
  // than during render, corrects this on first paint after a brief, acceptable flash of the
  // unsorted/unfiltered fetch — never a permanently-wrong count. `panelsSlice.ts`'s
  // `latestFetchRequestId` guard (CR2) is what makes "brief flash, then correct" true instead of
  // "maybe correct, depending on which response happens to land last".
  // HEL-1027 skeptic-final-2.md (round 2, REFUTE) CR1/CR2 — HARDENING, not a confirmed-reproduced
  // fix: extensive live probing (a freshly-restarted dev server, 11+ full-page reloads under
  // varied artificial network-latency orderings between the Output-metadata and rows round
  // trips, plus temporary console instrumentation of every step below) never reproduced the
  // skeptic's reported "zero filter= requests ever" outcome in this environment — every observed
  // run correctly fired the corrective fetch. Documented honestly in files-modified.md rather
  // than claimed as a confirmed root cause. That said, the ORIGINAL effect below (scoped to
  // `[seededOutputId]` alone, per the "eslint-disabled" exhaustive-deps suppression) rested on an
  // UNVERIFIED assumption: that `setSeededOutputId`/`setActiveSort`/`setActiveFilter` — three
  // separate `useState` calls in the render-phase block above — always commit together, in the
  // SAME render, so this effect's closure could never observe `seededOutputId` already updated
  // while `activeSort`/`activeFilter` still held their PRE-seed (null) values. That assumption is
  // exactly the failure mode skeptic-final-2.md's CR1 named as its leading hypothesis. This
  // version removes the assumption entirely rather than relying on it: `activeSort`/`activeFilter`
  // are now ALSO real dependencies, so if they are ever set on a LATER render than
  // `seededOutputId` (for any reason, including one this environment couldn't reproduce), this
  // effect re-runs with the CORRECT values instead of being permanently stuck with a stale
  // closure. `appliedPersistedDefaultRef` keeps the "fire the corrective fetch at most once"
  // contract — later `activeSort`/`activeFilter` changes from REAL user interaction go through
  // `handleSortChange`/`handleFilterChange`'s own `debouncedRefetch` instead, never this effect.
  const appliedPersistedDefaultRef = useRef(false);
  useEffect(() => {
    if (seededOutputId === null || appliedPersistedDefaultRef.current) return;
    appliedPersistedDefaultRef.current = true;
    // HEL-1190 design.md D3 — a control selection already active in the URL at first paint
    // (a pasted link, or a reload) is exactly the same "known before the first render, corrected
    // shortly after the initial unsorted/unfiltered mount fetch" case this effect already exists
    // for; `controlFilterOps` is available synchronously (URL-derived), so this is folded into
    // the SAME one-time correction rather than a second, independent mechanism.
    if (
      activeSort ||
      isFiltering(activeFilter ?? undefined) ||
      controlFilterOps.length > 0 ||
      crossFilterEq !== null
    ) {
      dispatchFetch(activeSort, activeFilter);
    }
    // controlFilterOps is read once here (mount-time value) — see the eslint-disable below for
    // why it's intentionally excluded from deps; a LATER change is the separate effect below's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededOutputId, activeSort, activeFilter, dispatchFetch]);

  // HEL-1190 design.md D3/task 4.4 — a control change AFTER the initial mount/seed (the effect
  // above already covers t=0) must independently re-trigger the SAME combined-filter fetch, since
  // `useViewerControls`'s URL state is invisible to `activeSort`/`activeFilter` above. Keyed on a
  // stable JSON string (not the `controlFilterOps` array's own identity, which the caller may
  // recompute every render) so this doesn't re-fire on an equal-but-new-identity array. Skipped
  // entirely until the mount-time correction above has already had its one chance to run, so the
  // two effects can never both fire for the very first, at-mount value.
  // HEL-1191 — `crossFilterEq` is part of the same change key (design.md D9a-ii).
  const controlFilterOpsKey = JSON.stringify([controlFilterOps, crossFilterEq]);
  const prevControlFilterOpsKeyRef = useRef(controlFilterOpsKey);
  useEffect(() => {
    if (!appliedPersistedDefaultRef.current) return;
    if (prevControlFilterOpsKeyRef.current === controlFilterOpsKey) return;
    prevControlFilterOpsKeyRef.current = controlFilterOpsKey;
    dispatchFetch(activeSort, activeFilter);
    // `activeSort`/`activeFilter` are read fresh from the closure on every re-run this key
    // triggers, matching `debouncedRefetch`'s own convention below — not independent triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlFilterOpsKey, dispatchFetch]);

  const handleSortChange = useCallback(
    (column: string, direction: SortDirection | null) => {
      const next = direction ? { key: column, direction } : null;
      setActiveSort(next);
      debouncedRefetch(next, activeFilter);
    },
    [activeFilter, debouncedRefetch],
  );

  const handleFilterChange = useCallback(
    (filters: TableColumnFilters) => {
      setActiveFilter(filters);
      debouncedRefetch(activeSort, filters);
    },
    [activeSort, debouncedRefetch],
  );

  return {
    filterActive: isFiltering(activeFilter ?? undefined),
    activeSort,
    activeFilter,
    handleSortChange,
    handleFilterChange,
  };
}
