import React, { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";

import { buildPanelSurface, resolvePanelTextColor } from "../../../theme/appearance";
import { getOutputId, isFullscreenEligible } from "../state/panelNarrowing";
import {
  clearSelection,
  deletePanel,
  duplicatePanel,
  fetchPanelPage,
  selectDataPoint,
} from "../state/panelsSlice";
import { getAssertionStatus } from "../../pipelines/services/outputService";
import { readChartConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useInFlightGuard } from "../../../hooks/useInFlightGuard";
import { useOutputMeta } from "../hooks/useOutputMeta";
import { ActionsMenu } from "../../../shared/chrome/ActionsMenu";
import { InlineError } from "../../../shared/chrome/InlineError";
import { IconButton } from "../../../shared/ui/IconButton";
import { TextField } from "../../../shared/ui/TextField";
import { PanelContent } from "./PanelContent";
import { PanelFullscreenOverlay } from "./PanelFullscreenOverlay";
import { PanelInspectView } from "./PanelInspectView";
import type { PanelDataResult } from "../hooks/usePanelData";
import { usePanelData } from "../hooks/usePanelData";
import { useCrossFilteredPanelData } from "../hooks/useCrossFilteredPanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import type { Panel } from "../types/panel";
import { resolveChartType } from "../../../utils/chartAppearance";
import type { ChartClickSelection, ChartInspectConfig } from "../../../utils/chartClickSelection";
import { GripVertical, Maximize2, RotateCw } from "lucide-react";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { Spinner } from "../../../shared/ui/Spinner";

// Exported for reuse by `MobilePanelStack` (HEL-301), which builds its own
// read-only card markup rather than reusing this file's drag/edit-oriented
// `PanelCard` wrapper — the appearance-to-style mapping is the one piece
// worth sharing so custom panel backgrounds/colors stay consistent between
// the desktop grid and the phone stack.
export function getPanelCardStyle(
  appearance: Panel["appearance"],
  theme: "dark" | "light",
): CSSProperties {
  const style = {} as CSSProperties & Record<string, string>;
  style["--panel-surface-override"] = buildPanelSurface(
    theme,
    appearance.background,
    appearance.transparency,
  );
  style["--panel-text-override"] = resolvePanelTextColor(
    theme,
    appearance.background,
    appearance.transparency,
    appearance.color,
  );
  return style;
}

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

interface PanelCardBodyProps extends Omit<PanelDataResult, "isRefreshing"> {
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
  chartAggregate,
  rowsTruncated,
  refresh,
  compact,
  onDataPointSelect,
}: PanelCardBodyProps) {
  const dispatch = useAppDispatch();
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

  const handleLoadMore = useCallback(() => {
    if (paginationEntry && !paginationEntry.isLoadingMore && outputId) {
      void dispatch(
        fetchPanelPage({
          panelId: panel.id,
          outputId,
          page: paginationEntry.currentPage + 1,
          pageSize: 50,
        }),
      );
    }
  }, [dispatch, panel.id, outputId, paginationEntry]);

  // All hooks are called unconditionally above; the early return is safe here.
  // Body is hidden only during active drag — title and handle remain visible.
  if (frozen) return null;

  return (
    <>
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
        noData={noData}
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
        chartAggregate={chartAggregate}
        compact={compact}
        onDataPointSelect={onDataPointSelect}
      />
      {/* HEL-1094 (design.md D5) — visually-hidden per-panel announcement region for an
          output-bound panel, reusing theme.css's canonical `.sr-only` clip (same recipe as
          Toast.tsx's live regions). `role="status"` carries an implicit `aria-live="polite"`;
          the counter suffix makes the accessible text genuinely change on every fan-out-triggered
          refresh, not merely re-render with identical text, per Standing Constraint C4 — verified
          via a computed-ARIA check, never by grepping for this attribute's presence. */}
      {outputId && (
        <div className="sr-only" role="status">
          {refreshAnnouncement > 0 ? `${panel.title} updated (refresh ${refreshAnnouncement})` : ""}
        </div>
      )}
    </>
  );
});

// Shell component for a single panel in the grid.  Wrapped in React.memo with a
// stable props contract so only the actively dragged panel (and the grid wrapper)
// re-renders during a drag operation — not all N panels.

export interface PanelCardProps {
  panel: Panel;
  theme: "dark" | "light";
  /** True while the user is dragging any panel; freezes this card's body. */
  isDragging: boolean;
  dashboardId: string;
  /** Pre-computed: editingTitleId === panel.id */
  isEditingTitle: boolean;
  /** Masked as "" for non-editing cards so their props are stable while user types. */
  editingTitle: string;
  editingTitleError: string | null;
  /** Pre-computed: confirmDeletePanelId === panel.id */
  isConfirmingDelete: boolean;
  // Stable callbacks from PanelGrid (all useCallback-wrapped there).
  onMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onCardClick: (panelId: string, e: React.MouseEvent<HTMLElement>) => void;
  onStartEdit: (panelId: string, currentTitle: string) => void;
  onTitleChange: (value: string) => void;
  onTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, panelId: string) => void;
  onTitleBlur: (panelId: string) => void;
  onRequestDelete: (panelId: string) => void;
  onCancelDelete: () => void;
  onDetail: (panelId: string) => void;
}

export const PanelCard = React.memo(function PanelCard({
  panel,
  theme,
  isDragging,
  dashboardId,
  isEditingTitle,
  editingTitle,
  editingTitleError,
  isConfirmingDelete,
  onMouseDown,
  onCardClick,
  onStartEdit,
  onTitleChange,
  onTitleKeyDown,
  onTitleBlur,
  onRequestDelete,
  onCancelDelete,
  onDetail,
}: PanelCardProps) {
  const dispatch = useAppDispatch();
  const { isPending, guardedRun } = useInFlightGuard<string>();

  // HEL-909: assertion status now reads the panel's bound Output
  // (`GET /api/outputs/:id/assertion-status`) rather than a DataType. Not
  // yet Redux-cached/deduped across panels sharing an Output — a follow-up,
  // since the prior DataType path's slice-level dedupe (`fetchAssertionStatus`'s
  // `condition`) has no Output-side equivalent yet.
  const outputId = getOutputId(panel);

  // HEL-579 design.md Decision 1: the SOLE `usePanelData(panel)` call site
  // for this panel — `PanelCard` is the nearest common ancestor of the
  // header (where the Refresh control below renders) and `PanelCardBody`
  // (where the rest of this result is consumed). See that component's own
  // doc comment for why a second, independent call here would defeat the
  // shared in-flight guard.
  const panelData = usePanelData(panel);
  const { refresh, isRefreshing } = panelData;

  // HEL-584 design.md Decision 2 — the fullscreen overlay consumes THIS
  // `panelData` result as props (below); it never calls `usePanelData`
  // itself, so opening it can't race HEL-579's in-flight refresh guard with
  // a second, independent fetch instance for the same panel.
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const handleOpenFullscreen = useCallback(() => setIsFullscreenOpen(true), []);
  const handleCloseFullscreen = useCallback(() => setIsFullscreenOpen(false), []);

  // HEL-572 design.md D1/D5 — a SECOND, independent `useOutputMeta` fetch
  // (mirrors the existing precedent: `PanelContent`'s own `OutputPanelContent`
  // and `usePanelRunRefresh`, called from `PanelCardBody`, each already fetch
  // this same Output independently). Resolved HERE (not re-fetched again by
  // `PanelFullscreenOverlay`) specifically so mounting the fullscreen overlay
  // — which HEL-584 mounts unconditionally, gated only on eligibility, not on
  // `isFullscreenOpen` — never adds a THIRD/FOURTH redundant network call;
  // `chartInspectConfig` below is computed once and threaded down as a prop.
  const { output } = useOutputMeta(outputId);
  const chartInspectConfig: ChartInspectConfig | null = useMemo(() => {
    if (output?.kind !== "chart") return null;
    const cfg = readChartConfig(output.config);
    return {
      chartType: resolveChartType(panel.appearance.chart),
      fieldMapping: cfg.fieldMapping,
      scatterOptions: cfg.chartOptions?.scatter,
    };
  }, [output, panel.appearance.chart]);

  // HEL-588 design.md D4 / evaluation-1.md CR1 (cycle 2) / skeptic-final-1.md
  // CR1 (cycle 3) / evaluation-3.md CR1 (cycle 3) — the ALREADY
  // cross-filtered rawRows/headers, used by EVERY `PanelInspectView` mount
  // (both the grid-context one below AND, via `inspectRawRows`/
  // `inspectHeaders`, the one nested inside `PanelFullscreenOverlay`):
  // Inspect renders its own `DataGrid` directly from these props rather than
  // going through `PanelContent`/`OutputPanelContent`, so it's the one
  // consumer that genuinely needs the filtered values threaded down to it
  // explicitly, in BOTH mount contexts. `PanelCardBody`/
  // `PanelFullscreenOverlay`'s own `<PanelContent>` calls receive the RAW
  // `panelData.rawRows`/`panelData.headers` instead (see their own call
  // sites below) — `OutputPanelContent` filters those itself, using ITS OWN
  // already-resolved `output` (no new fetch, no race), and needs the RAW
  // input specifically so its `crossFilterLoadedRowCount` truncation-count
  // math reads the panel's TRUE total loaded rows, not an already-narrowed
  // count (skeptic-final-1.md CR1's fix). Reuses THIS component's own
  // pre-existing `output` (never a second fetch) — exactly the same one
  // `chartInspectConfig` above already resolves.
  //
  // History (two related-but-distinct defects, same class, one call site
  // apart): skeptic-final-1.md CR1 fixed `PanelFullscreenOverlay` receiving
  // these cross-filtered values for its `<PanelContent>` prop (corrupting
  // the truncation count) by switching that ONE prop pair to raw. That fix's
  // own side effect — `PanelFullscreenOverlay` has only ONE `rawRows`/
  // `headers` prop pair internally, shared by its `<PanelContent>` AND its
  // nested `<PanelInspectView>` — meant the nested Inspect ALSO started
  // reading raw rows, silently ignoring the active cross-filter for a
  // sibling panel's own click-selection (evaluation-3.md's live repro: a
  // panel plotted by "region" but filterable by "quarter" correctly showed 1
  // row in the grid's Inspect and incorrectly showed all 4 in Fullscreen's).
  // Fixed by giving `PanelFullscreenOverlay` a SECOND, separate prop pair
  // (`inspectRawRows`/`inspectHeaders`) so its two internal consumers can
  // each get what they need without one shared value serving both.
  const { rawRows: crossFilteredRawRows, headers: crossFilteredHeaders } =
    useCrossFilteredPanelData(panel, panelData.rawRows, panelData.headers, output);

  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const handleDataPointSelect = useCallback(
    (selection: ChartClickSelection) => {
      dispatch(selectDataPoint({ panelId: panel.id, ...selection }));
      setIsInspectOpen(true);
    },
    [dispatch, panel.id],
  );
  // spec.md "The selection descriptor is view state, cleared on panel/
  // dashboard switch" — Modal's own dismiss (Escape/backdrop/X) closes the
  // view WITHOUT clearing the selection; only the explicit clear/return
  // control (handleClearInspect) does both. See `PanelInspectView`'s own
  // `onClose`/`onClear` doc comments.
  const handleCloseInspect = useCallback(() => setIsInspectOpen(false), []);
  const handleClearInspect = useCallback(() => {
    setIsInspectOpen(false);
    dispatch(clearSelection(panel.id));
  }, [dispatch, panel.id]);
  const handleOpenInspectFromMenu = useCallback(() => setIsInspectOpen(true), []);

  const [isDataInvalid, setIsDataInvalid] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (outputId) {
      void getAssertionStatus(outputId)
        .then((status) => {
          if (!cancelled) setIsDataInvalid(status.invalid);
        })
        .catch(() => {
          if (!cancelled) setIsDataInvalid(false);
        });
    } else {
      // No bound Output — resolve asynchronously (not a synchronous setState
      // call inside the effect body) so switching a panel away from an
      // Output still clears a previously-set invalid flag.
      void Promise.resolve().then(() => {
        if (!cancelled) setIsDataInvalid(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [outputId]);

  // 2.2 — Memoize style to avoid a new object identity on every render.
  const style = useMemo(
    () => getPanelCardStyle(panel.appearance, theme),
    [panel.appearance, theme],
  );

  // 2.3 — Stable panel-specific callbacks; only recreate when panel.id changes.
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => onCardClick(panel.id, e),
    [panel.id, onCardClick],
  );

  const handleRename = useCallback(
    () => onStartEdit(panel.id, panel.title),
    [panel.id, panel.title, onStartEdit],
  );

  const handleDetail = useCallback(() => onDetail(panel.id), [panel.id, onDetail]);

  const handleDuplicate = useCallback(
    () => guardedRun(panel.id, () => dispatch(duplicatePanel({ panelId: panel.id, dashboardId }))),
    [guardedRun, dispatch, panel.id, dashboardId],
  );

  const handleRequestDelete = useCallback(
    () => onRequestDelete(panel.id),
    [panel.id, onRequestDelete],
  );

  const handleConfirmDelete = useCallback(() => {
    void dispatch(deletePanel({ panelId: panel.id, dashboardId }));
    onCancelDelete();
  }, [dispatch, panel.id, dashboardId, onCancelDelete]);

  const handleTitleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onTitleChange(e.target.value),
    [onTitleChange],
  );

  const handleTitleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => onTitleKeyDown(e, panel.id),
    [panel.id, onTitleKeyDown],
  );

  const handleTitleBlur = useCallback(() => onTitleBlur(panel.id), [panel.id, onTitleBlur]);

  return (
    <article
      className="panel-grid-card"
      style={style}
      onMouseDown={onMouseDown}
      onClick={handleClick}
    >
      <div className="panel-grid-card__top">
        <div className="panel-grid-card__title-area">
          {isEditingTitle ? (
            <>
              <TextField
                className="panel-grid-card__title-input"
                type="text"
                value={editingTitle}
                autoFocus
                aria-label="Panel title"
                onChange={handleTitleInputChange}
                onKeyDown={handleTitleKeyDown}
                onBlur={handleTitleBlur}
              />
              <InlineError error={editingTitleError} />
            </>
          ) : (
            <>
              <h3 className="panel-grid-card__title">{panel.title}</h3>
            </>
          )}
        </div>
        <div className="panel-grid-card__actions">
          {isConfirmingDelete ? (
            <>
              <button
                type="button"
                className="panel-grid-card__delete-confirm-btn"
                onClick={handleConfirmDelete}
              >
                Confirm
              </button>
              <IconButton
                icon="×"
                variant="secondary"
                size="xs"
                aria-label={`Cancel delete ${panel.title}`}
                onClick={onCancelDelete}
              />
            </>
          ) : (
            // F-128: the drag handle is only meaningful once the header
            // returns to its normal (non-delete-confirm) state — rendering it
            // alongside Confirm/× crowds the header at the exact moment the
            // user should be making a focused binary choice.
            <>
              {/* HEL-579: output-bound panels only (design.md Goals /
                  spec.md "no Refresh control for a non-output panel"). Kept
                  visible during title-editing (like the drag handle below,
                  unlike ActionsMenu) since refreshing data is unrelated to
                  renaming. `refresh` and `isRefreshing` come from the single
                  `usePanelData(panel)` call above — no prop-threading
                  through `PanelCardBody` needed for this button. */}
              {outputId && (
                <IconButton
                  icon={
                    isRefreshing ? (
                      <Spinner size="sm" />
                    ) : (
                      <RotateCw aria-hidden="true" size={ICON_SIZE.sm} />
                    )
                  }
                  variant="secondary"
                  size="xs"
                  className="panel-grid-card__refresh-btn"
                  aria-label={`Refresh ${panel.title}`}
                  disabled={isRefreshing}
                  onClick={refresh}
                />
              )}
              {/* HEL-584: view-only fullscreen/focus-mode overlay, gated on
                  the eligible content kinds (design.md Decision 3 — excludes
                  `divider`/`form`). Kept visible during title-editing, like
                  the Refresh control above, since it's unrelated to
                  renaming. */}
              {isFullscreenEligible(panel) && (
                <IconButton
                  icon={<Maximize2 aria-hidden="true" size={ICON_SIZE.sm} />}
                  variant="secondary"
                  size="xs"
                  className="panel-grid-card__fullscreen-btn"
                  aria-label={`Fullscreen ${panel.title}`}
                  title="Fullscreen"
                  onClick={handleOpenFullscreen}
                />
              )}
              {isEditingTitle ? null : (
                <ActionsMenu
                  label={`${panel.title} panel actions`}
                  items={[
                    { label: "Rename", onClick: handleRename },
                    { label: "Customize", onClick: handleDetail },
                    {
                      label: "Duplicate",
                      onClick: handleDuplicate,
                      disabled: isPending(panel.id),
                    },
                    // HEL-572 design.md D7 — chart-eligible panels only
                    // (`chartInspectConfig` is non-null exactly then); opens
                    // for the panel's current selection, or `PanelInspectView`'s
                    // own empty state when nothing is selected yet.
                    ...(chartInspectConfig
                      ? [{ label: "Inspect", onClick: handleOpenInspectFromMenu }]
                      : []),
                    { label: "Delete", onClick: handleRequestDelete, danger: true },
                  ]}
                />
              )}
              <button
                type="button"
                className="panel-grid-card__handle"
                aria-label={`Move ${panel.title} panel`}
                title={`Move ${panel.title} panel`}
              >
                {/* F-099: a grip-vertical glyph reads as distinctly different
                    from the adjacent ActionsMenu trigger's horizontal 3-dot
                    ellipsis, instead of the old 2-dot mark that only differed
                    from it by dot count. */}
                <GripVertical aria-hidden="true" size={ICON_SIZE.sm} />
              </button>
            </>
          )}
        </div>
      </div>
      {/* HEL-579 design.md Decision 1: individual props, NOT a single spread
          object — `PanelCardBody` is wrapped in `React.memo`, and a fresh
          object literal every render would defeat its shallow-prop
          comparison on every render (dragging or not). `refresh` stays a
          stable `useCallback([])` reference and `rawRows`/`headers` stay
          `useMemo`-stable, so memo bails correctly when only unrelated
          `PanelCard` state (e.g. title-edit keystrokes) changes. */}
      <PanelCardBody
        panel={panel}
        frozen={isDragging}
        outputId={outputId}
        data={panelData.data}
        rawRows={panelData.rawRows}
        headers={panelData.headers}
        isLoading={panelData.isLoading}
        error={panelData.error}
        errorKind={panelData.errorKind}
        noData={panelData.noData}
        neverMaterialized={panelData.neverMaterialized}
        chartAggregate={panelData.chartAggregate}
        rowsTruncated={panelData.rowsTruncated}
        refresh={panelData.refresh}
        onDataPointSelect={handleDataPointSelect}
      />
      {/* HEL-572 design.md D5 — the grid-context inspect view (`DataGrid
          variant="preview"`), gated on `chartInspectConfig` (chart-eligible
          panels only — non-output panels, and non-chart-kind output panels,
          mount nothing here). Owns its own `isInspectOpen` local boolean,
          parallel to the fullscreen overlay's own `isFullscreenOpen` above;
          the SELECTION itself is the single Redux-owned source of truth
          `PanelInspectView` reads directly (see that component). */}
      {chartInspectConfig && (
        <PanelInspectView
          panelId={panel.id}
          panelTitle={panel.title}
          open={isInspectOpen}
          onClose={handleCloseInspect}
          onClear={handleClearInspect}
          rawRows={crossFilteredRawRows}
          headers={crossFilteredHeaders}
          chartInspectConfig={chartInspectConfig}
          rowsTruncated={panelData.rowsTruncated}
          variant="preview"
        />
      )}
      {/* HEL-584 design.md Decision 2/3 — mounted unconditionally (matching
          `QuickLauncherOverlay`'s always-mounted-with-a-toggled-`open`-prop
          precedent), gated only on eligibility so excluded kinds get no
          trace of this overlay, not just a hidden control. Visibility is
          the `open` prop, not mount/unmount — see that component's own doc
          comment for why (Modal's focus-restore effect needs a real
          `open` transition, not a fresh mount that starts already-open).
          Fed the SAME `panelData` result the body above receives, never its
          own `usePanelData` call. */}
      {isFullscreenEligible(panel) && (
        <PanelFullscreenOverlay
          panel={panel}
          open={isFullscreenOpen}
          onClose={handleCloseFullscreen}
          data={panelData.data}
          // skeptic-final-1.md CR1 — `rawRows`/`headers` here feed THIS
          // overlay's OWN `<PanelContent>` and must stay RAW (matching
          // `PanelCardBody`'s call): `OutputPanelContent` (reached via
          // `<PanelContent>`) is the ONE place that applies the cross-filter,
          // using ITS OWN already-resolved `output` — feeding it an
          // ALREADY-filtered `rawRows` corrupted `crossFilterLoadedRowCount`
          // (the D7 truncation disclosure's denominator) down to the
          // post-filter match count (probe-confirmed live: "50 of 50" instead
          // of the grid card's correct "50 of 200").
          rawRows={panelData.rawRows}
          headers={panelData.headers}
          // evaluation-3.md CR1 — a SEPARATE prop pair for the overlay's
          // nested `PanelInspectView` specifically, which needs the OPPOSITE
          // of the above: the ALREADY cross-filtered values (the same ones
          // the grid-context `PanelInspectView` below already gets), since
          // Inspect renders its own `DataGrid` directly from these rather
          // than going through `OutputPanelContent`. Without this second pair
          // the overlay's chart correctly narrows by the active cross-filter
          // while its own nested Inspect (for an identical click) silently
          // ignored it — a live-reproduced violation of HEL-572's preserved
          // "Inspect shows exactly the plotted rows for its selection"
          // invariant (probe: a panel plotted by "region" but filterable by
          // "quarter" showed the grid's Inspect correctly narrowing to 1 row
          // while Fullscreen's nested Inspect for the identical click showed
          // all 4, even though the Fullscreen chart itself visibly plotted
          // only 1 point).
          inspectRawRows={crossFilteredRawRows}
          inspectHeaders={crossFilteredHeaders}
          isLoading={panelData.isLoading}
          error={panelData.error}
          errorKind={panelData.errorKind}
          noData={panelData.noData}
          neverMaterialized={panelData.neverMaterialized}
          chartAggregate={panelData.chartAggregate}
          rowsTruncated={panelData.rowsTruncated}
          refresh={panelData.refresh}
          chartInspectConfig={chartInspectConfig}
        />
      )}
      <div className="panel-grid-card__footer">
        <span className="panel-grid-card__type-badge">{panel.type}</span>
        {isDataInvalid && (
          <span
            className="panel-grid-card__type-badge panel-grid-card__type-badge--invalid"
            title="The latest pipeline run for this panel's data failed an assertion rule"
          >
            Invalid data
          </span>
        )}
        <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
      </div>
    </article>
  );
});
