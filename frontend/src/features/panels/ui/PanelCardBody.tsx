import React, { useCallback, useMemo, useState } from "react";
import { isOutputPanel } from "../state/panelNarrowing";
import { fetchPanelPage } from "../state/panelsSlice";
import { useFirstDashboardRendered } from "../../telemetry/useFirstDashboardRendered";
import { composeOutputRowsFilter, getDistinctValues } from "../../pipelines/services/outputService";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useOutputMeta } from "../hooks/useOutputMeta";
import { useCrossFilterServerOps } from "../hooks/useCrossFilterServerOps";
import { useCrossFilterAnnouncement } from "../hooks/useCrossFilterAnnouncement";
import { usePanelSortFilter } from "../hooks/usePanelSortFilter";
import { useViewerControls } from "../hooks/useViewerControls";
import { buildViewerControlFilterOps } from "../state/viewerControlValues";
import { OutputViewerControlBar } from "./OutputViewerControlBar";
import { PanelContent } from "./PanelContent";
import { controlResultCountText } from "./controlResultCountText";
import type { PanelDataResult } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import type { OutputControlSpec, Panel } from "../types/panel";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";

// Data-driven body content of a panel.  Wrapped in React.memo so it skips
// re-renders when its `panel` prop is referentially unchanged, and returns null
// immediately when `frozen` is true so expensive chart/table repaints are
// suppressed during drag operations.
//
// HEL-579 design.md Decision 1: `usePanelData(panel)` is called exactly ONCE,
// by the nearest common ancestor of the header (where the Refresh control
// renders) and this body (where the data is consumed) — `PanelCard` for the
// desktop grid, `MobilePanelStack` for the phone stack. This component
// receives the hook's result as individual props rather than calling the
// hook itself, so both callers share one `inFlightRef`/`refreshToken` state
// tree per panel instead of racing two independent ones.

// `paginationRows` is omitted: the body reads its own `paginationEntry` (see below).
interface PanelCardBodyProps extends Omit<PanelDataResult, "isRefreshing" | "paginationRows"> {
  panel: Panel;
  /** When true the body short-circuits and renders nothing (drag-freeze). */
  frozen: boolean;
  /** `getOutputId(panel)`, computed once by the caller alongside its
   *  `usePanelData(panel)` call rather than re-derived here. */
  outputId: string | null;
  /** HEL-301: true when rendered in the phone stack — forwarded to
   *  `ChartRenderer` so ECharts hides the legend and shrinks axis labels
   *  instead of overflowing a narrow phone width (W5). No effect on other
   *  renderers; unset (desktop grid) is unchanged. */
  compact?: boolean;
  /** HEL-572: forwarded to `PanelContent` — see `ChartPanel`'s
   *  `onDataPointSelect` prop. */
  onDataPointSelect?: (selection: ChartClickSelection) => void;
}

// HEL-1190 — a stable, module-level empty array for a non-output panel's "controls" so
// `controls`'s identity never churns across renders for that branch (a fresh `[]` literal inline
// in the ternary below would defeat every `useMemo`/`useCallback` that lists `controls` as a
// dependency, on every single render of a non-output panel).
const EMPTY_CONTROLS: OutputControlSpec[] = [];

export const PanelCardBody = React.memo(function PanelCardBody({
  panel,
  frozen,
  outputId,
  data,
  rawRows,
  headers,
  isLoading,
  error,
  errorKind,
  noData,
  neverMaterialized,
  rowsTruncated,
  refresh,
  compact,
  onDataPointSelect,
}: PanelCardBodyProps) {
  const dispatch = useAppDispatch();
  // HEL-1208: an output panel with at least one loaded row is what counts as a rendered dashboard.
  useFirstDashboardRendered(outputId != null && !isLoading && !error && (rawRows?.length ?? 0) > 0);
  // HEL-1027 skeptic-final-3.md CR1 (cycle 4) — `PanelCardBody` is the actual shared ancestor of
  // BOTH top-level callers (`PanelCard`'s desktop grid AND `MobilePanelStack`'s phone stack), so
  // resolving the Output HERE — once — and threading it both to `usePanelSortFilter` (below) and
  // down through `PanelContent`/`OutputPanelContent` (which now accepts it as a prop instead of
  // fetching its own copy — see that component) gives every consumer the SAME single fetch,
  // rather than two independently-resolving ones that could disagree for up to a render.
  // Previously, `output` arrived here as an OPTIONAL prop that only `PanelCard` (desktop) ever
  // supplied (from ITS OWN separate `useOutputMeta` call, kept for `chartInspectConfig`) —
  // `MobileStackPanelBody` had no resolved Output to offer at all, so this hook's persisted-
  // default correction effect could never seed on the phone-stack path (`seededOutputId` stayed
  // `null` forever): a table panel with a persisted `columnFilters` default rendered in
  // `MobilePanelStack` settled on the server's UNFILTERED total, deterministically, on every load
  // — see `grid/MobilePanelStack.staleFetchSequencing.test.tsx` for the regression proof. This does NOT
  // reintroduce the DIFFERENT, already-fixed `evaluation-1.md` CR1/CR2 race (a SECOND independent
  // `useOutputMeta` call inside `MobileStackPanelBody` itself, used for cross-filtering, racing
  // against `OutputPanelContent`'s own): that fix's invariant — cross-filtering reads `output`
  // from exactly ONE fetch — is preserved here, since `OutputPanelContent` no longer performs its
  // own fetch AT ALL once this component supplies one (see its own doc comment).
  const { output, isLoading: isOutputMetaLoading } = useOutputMeta(outputId);

  // HEL-1190 design.md D1-D4 (tasks 4.1-4.5, 5.1/5.2) — the viewer's own control selection,
  // URL-held (`useViewerControls`) and shared by construction between the desktop grid and the
  // phone stack, since `PanelCardBody` is their common ancestor (mirrors HEL-1027's own
  // `usePanelSortFilter` precedent one line below). `controls` is `[]` for a non-output panel —
  // `useViewerControls`/`buildViewerControlFilterOps` are then no-ops.
  const controls: OutputControlSpec[] = isOutputPanel(panel)
    ? panel.config.controls
    : EMPTY_CONTROLS;
  const {
    values: controlValues,
    setValue: setControlValue,
    clearValue: clearControlValue,
  } = useViewerControls(panel.id, controls);
  const controlFilterOps = useMemo(
    () => buildViewerControlFilterOps(controls, controlValues),
    [controls, controlValues],
  );
  const hasVisibleControls = useMemo(() => controls.some((c) => !c.orphaned), [controls]);
  const fetchDistinctValues = useCallback(
    (column: string) =>
      outputId ? getDistinctValues(outputId, column).then((r) => r.values) : Promise.resolve([]),
    [outputId],
  );

  // HEL-1027 design.md D4/D10 (tasks 4.1-4.3, 4.7) — the authoritative sort/filter state driving
  // this panel's server-side round trip; see the hook's own doc comment for the full contract.
  // HEL-1190 design.md D3 (task 4.3) — `controlFilterOps` above composes into every dispatch this
  // hook makes, ANDed with whatever in-panel sort/filter is also active.
  // HEL-1191 design.md D1/D3/D9b — the ONE cross-filter eligibility decision for this panel:
  // `crossFilterEq` (server path) goes to every dispatch as its own argument, `crossFilterMode`
  // goes down to `PanelContent` so the client-side loaded-rows filter runs ONLY on the fallback.
  const { crossFilterEq, mode: crossFilterMode } = useCrossFilterServerOps(panel, output);
  const { filterActive, activeSort, activeFilter, handleSortChange, handleFilterChange } =
    usePanelSortFilter(panel.id, outputId, output, controlFilterOps, crossFilterEq);
  // HEL-1027 design.md D10 — suppresses `PanelContent`'s top-level `noData`/`neverMaterialized`
  // short-circuit whenever a table filter is genuinely active, so a filter matching zero rows
  // across the whole Output falls through to `TableRenderer`'s own correct
  // "No rows match your filter." + "Clear filters" empty state instead of the generic
  // "No data available" one. Never affects a non-table panel: `filterActive` can only be true
  // once `TableRenderer`'s own filter UI has set it (D4), which only exists for `table`-kind
  // Outputs in the first place.
  const effectiveNoData = noData && !filterActive;
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);
  // evaluation-1.md CR1 (cycle 2) — this selector's raw `paginationEntry.rows`
  // is passed straight through to `PanelContent`'s `paginationRows` prop
  // below UNFILTERED, exactly like `rawRows`/`headers` above; the dashboard's
  // active cross-filter is applied ONCE, downstream, inside
  // `OutputPanelContent` (which already resolves the SAME Output this
  // component needs for table/chart/etc. rendering — see that component's
  // own comment for why applying the filter there, rather than here or in
  // `PanelCard`, is what actually keeps a Table-kind panel's `paginationRows`
  // branch and its `rawRows` fallback in permanent agreement).
  usePanelPolling(refresh, panel.refreshInterval ?? null, outputId);

  // HEL-1094 (design.md D4/D5) — fans this panel into the shared per-pipeline run-status SSE
  // subscription; `refresh` re-fetches on a `succeeded` event, and `refreshAnnouncement` (bumped
  // in the same callback) drives the sr-only status region below so a screen reader hears a
  // genuinely new announcement on every fan-out-triggered refresh. Bumped here — inside the
  // callback `usePanelRunRefresh` invokes from its own subscription effect, not inside a
  // `useEffect` body of this component — per react.dev's "subscribe to an external system, call
  // setState in a callback" pattern (`react-hooks/set-state-in-effect` flags the alternative of
  // deriving this from a watched-value-changed effect as an unnecessary effect for pure derived
  // state, and this codebase's stricter `react-hooks/refs` additionally forbids the
  // previous-value-ref comparison that pattern would otherwise need during render).
  const [refreshAnnouncement, setRefreshAnnouncement] = useState(0);
  const handleFanoutRefresh = useCallback(() => {
    refresh();
    setRefreshAnnouncement((n) => n + 1);
  }, [refresh]);
  usePanelRunRefresh(outputId, handleFanoutRefresh);

  // HEL-1027 skeptic-final-1.md follow-on finding — "Load more" (page > 0) must carry the SAME
  // active sort/filter the current page-0 window was fetched under, or the appended page would
  // silently revert to the raw/unfiltered default (a page-1 fetch with no `sort`/`filter` at all
  // does not restrict itself to the same rows the just-sorted/filtered page 0 came from) — a
  // direct AC #2 ("no duplicated or dropped rows across pages") violation for a sorted/filtered
  // table specifically. `activeSort`/`activeFilter` come from `usePanelSortFilter`, the same
  // authoritative state a sort/filter CHANGE already uses.
  const handleLoadMore = useCallback(() => {
    if (paginationEntry && !paginationEntry.isLoadingMore && outputId) {
      void dispatch(
        fetchPanelPage({
          panelId: panel.id,
          outputId,
          page: paginationEntry.currentPage + 1,
          pageSize: 50,
          sort: activeSort
            ? { column: activeSort.key, direction: activeSort.direction }
            : undefined,
          // HEL-1190 design.md D3/task 4.3 — an appended page must carry the SAME combined
          // filter (in-panel + viewer-control) the current page-0 window was fetched under, for
          // the same reason `activeSort`/`activeFilter` already had to be threaded here.
          filter: composeOutputRowsFilter(activeFilter, controlFilterOps),
          // HEL-1191 design.md D5 — the appended page belongs to the SAME filtered set.
          crossFilterEq,
        }),
      );
    }
  }, [
    dispatch,
    panel.id,
    outputId,
    paginationEntry,
    activeSort,
    activeFilter,
    controlFilterOps,
    crossFilterEq,
  ]);

  const activeCrossFilter = useAppSelector((state) => state.panels.crossFilter ?? null);
  const crossFilterAnnouncement = useCrossFilterAnnouncement(crossFilterEq, paginationEntry);

  // HEL-1190 design.md D10 (task 5.5) — REUSES this panel's existing live region (below) rather
  // than adding a second one: `PanelCardBody` is the shared ancestor of BOTH the desktop grid
  // (`PanelCard`) and the phone stack (`MobilePanelStack` imports this same component) — grepping
  // for the region by FILE name alone (`MobilePanelStack.tsx`) misses that it already renders
  // this region transitively, which design.md's own D10 survey did not account for. A control-
  // driven row-count change is therefore announced via the SAME region a fan-out refresh already
  // uses, picking whichever is the more recent event; `hasVisibleControls` gates this text to
  // panels that actually have a control bar; a control-free panel's announcement is unchanged.
  const resultAnnouncementText =
    crossFilterAnnouncement !== ""
      ? crossFilterAnnouncement
      : refreshAnnouncement > 0
        ? `${panel.title} updated (refresh ${refreshAnnouncement}).`
        : hasVisibleControls && paginationEntry && !paginationEntry.isLoadingMore
          ? controlResultCountText(paginationEntry, crossFilterMode, activeCrossFilter)
          : "";

  // All hooks are called unconditionally above; the early return is safe here.
  // Body is hidden only during active drag — title and handle remain visible.
  if (frozen) return null;

  return (
    <>
      {hasVisibleControls && (
        <OutputViewerControlBar
          controls={controls}
          values={controlValues}
          onChange={setControlValue}
          onClear={clearControlValue}
          fetchDistinctValues={fetchDistinctValues}
        />
      )}
      <PanelContent
        panel={panel}
        appearance={panel.appearance}
        data={data}
        rawRows={rawRows}
        headers={headers}
        isLoading={isLoading}
        error={error}
        errorKind={errorKind}
        onRetry={refresh}
        retryVariant="icon-only"
        noData={effectiveNoData}
        neverMaterialized={neverMaterialized}
        paginationRows={paginationEntry?.rows ?? null}
        paginationIsLoadingMore={paginationEntry?.isLoadingMore ?? false}
        onLoadMore={handleLoadMore}
        // HEL-451 design D4/task 4.0: `rowsTruncated` (from `usePanelData`) is
        // the branch-independent truncation signal — must be wired at BOTH
        // `PanelContent` call sites (this one AND `PanelDetailModal.tsx:400`),
        // or the inversion this task fixes just relocates to the surface
        // whichever call site is missed.
        rowsTruncated={rowsTruncated}
        compact={compact}
        onDataPointSelect={onDataPointSelect}
        onSortChange={handleSortChange}
        onFilterChange={handleFilterChange}
        // HEL-1027 design.md D5/D7 — the server's row count for the CURRENT sort/filter (D5),
        // threaded through to `TableRenderer`'s loaded-scope disclosure so a filtered count
        // describes the WHOLE Output, never just the currently-loaded page (task 5.2).
        totalRowCount={paginationEntry?.total}
        filteredMetric={paginationEntry?.metric}
        // HEL-1027 skeptic-final-3.md CR1 (cycle 4) — this component's OWN `useOutputMeta`
        // result (above), so `OutputPanelContent` renders from the SAME fetch this component's
        // `usePanelSortFilter` already seeded from, instead of independently fetching its own
        // copy. See `PanelContentProps.output`'s own doc comment for the full contract.
        output={output}
        viewerFilterActive={controlFilterOps.length > 0}
        outputMetaLoading={isOutputMetaLoading}
        crossFilterMode={crossFilterMode}
      />
      {/* HEL-1094 (design.md D5) — visually-hidden per-panel announcement region for an
          output-bound panel, reusing theme.css's canonical `.sr-only` clip (same recipe as
          Toast.tsx's live regions). `role="status"` carries an implicit `aria-live="polite"`.
          HEL-1190 design.md D10 (task 5.5) — this SAME region now ALSO carries a control-driven
          result-count announcement (`resultAnnouncementText`, computed above), reused rather than
          a second, redundant region — the panel's row count changing is exactly the kind of
          "genuinely different text on every relevant event" this region already guarantees for a
          fan-out refresh (Standing Constraint C4 — verified via a computed-ARIA check, never by
          grepping for this attribute's presence). */}
      {outputId && (
        <div className="sr-only" role="status">
          {resultAnnouncementText}
        </div>
      )}
    </>
  );
});
