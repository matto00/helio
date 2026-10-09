import React, { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildPanelSurface, resolvePanelTextColor } from "../../../theme/appearance";
import { getOutputId, isFullscreenEligible } from "../state/panelNarrowing";
import { deletePanel, duplicatePanel } from "../state/panelsSlice";
import { ProvenanceTrigger } from "../provenance/ProvenanceTrigger";
import { useDataInvalid } from "../provenance/useDataInvalid";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useInFlightGuard } from "../../../hooks/useInFlightGuard";
import { PanelFullscreenOverlay } from "./PanelFullscreenOverlay";
import { PanelCardHeader } from "./PanelCardHeader";
import { PanelCardBody } from "./PanelCardBody";
import { usePanelCardInspect } from "../hooks/usePanelCardInspect";
import { PanelInspectView } from "./PanelInspectView";
import { usePanelData } from "../hooks/usePanelData";
import { useOutputRetention } from "../hooks/useOutputRetention";
import type { Panel } from "../types/panel";

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
  // header (`PanelCardHeader`, where the Refresh control renders) and `PanelCardBody`
  // (where the rest of this result is consumed). See that component's own
  // doc comment for why a second, independent call here would defeat the
  // shared in-flight guard.
  // HEL-1392 design.md D1/D2: the Output stays trusted while this card is on screen (and briefly
  // after), and `mountOwnership` lets the body's persisted-default correction own the mount request.
  useOutputRetention(outputId);
  const mountOwnership = useRef(false);
  const panelData = usePanelData(panel, [], null, { mountOwnership });
  const { refresh, isRefreshing } = panelData;

  // HEL-584 design.md Decision 2 — the fullscreen overlay consumes THIS
  // `panelData` result as props (below); it never calls `usePanelData`
  // itself, so opening it can't race HEL-579's in-flight refresh guard with
  // a second, independent fetch instance for the same panel.
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const handleOpenFullscreen = useCallback(() => setIsFullscreenOpen(true), []);
  const handleCloseFullscreen = useCallback(() => setIsFullscreenOpen(false), []);

  const {
    chartInspectConfig,
    crossFilterMode,
    crossFilteredRawRows,
    crossFilteredHeaders,
    crossFilteredRecords,
    isInspectOpen,
    handleDataPointSelect,
    handleCloseInspect,
    handleClearInspect,
    handleOpenInspectFromMenu,
  } = usePanelCardInspect(panel, outputId, panelData);

  // HEL-1207 A4: the badge's status read is deduped across consumers and, once the provenance
  // popover has loaded, derived from its cache.
  const isDataInvalid = useDataInvalid(outputId);

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
      <PanelCardHeader
        panel={panel}
        isEditingTitle={isEditingTitle}
        editingTitle={editingTitle}
        editingTitleError={editingTitleError}
        isConfirmingDelete={isConfirmingDelete}
        outputId={outputId}
        refresh={refresh}
        isRefreshing={isRefreshing}
        isPending={isPending}
        chartInspectConfig={chartInspectConfig}
        onCancelDelete={onCancelDelete}
        handleConfirmDelete={handleConfirmDelete}
        handleOpenFullscreen={handleOpenFullscreen}
        handleRename={handleRename}
        handleDetail={handleDetail}
        handleDuplicate={handleDuplicate}
        handleOpenInspectFromMenu={handleOpenInspectFromMenu}
        handleRequestDelete={handleRequestDelete}
        handleTitleInputChange={handleTitleInputChange}
        handleTitleKeyDown={handleTitleKeyDown}
        handleTitleBlur={handleTitleBlur}
      />
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
        rowsTruncated={panelData.rowsTruncated}
        refresh={panelData.refresh}
        mountOwnership={mountOwnership}
        onDataPointSelect={handleDataPointSelect}
      />
      {/* HEL-572 design.md D5 — the grid-context inspect view (`DataGrid
          variant="preview"`), gated on `chartInspectConfig` (chart-eligible
          panels only — non-output panels, and non-chart-kind output panels,
          mount nothing here). Its `isInspectOpen` local boolean (owned by `usePanelCardInspect`) is
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
          records={crossFilteredRecords}
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
          paginationRows={panelData.paginationRows}
          inspectRecords={crossFilteredRecords}
          rowsTruncated={panelData.rowsTruncated}
          refresh={panelData.refresh}
          chartInspectConfig={chartInspectConfig}
          crossFilterMode={crossFilterMode}
        />
      )}
      <div className="panel-grid-card__footer">
        <span className="panel-grid-card__type-badge">{panel.type}</span>
        {outputId && (
          <ProvenanceTrigger
            panelId={panel.id}
            panelTitle={panel.title}
            outputId={outputId}
            variant="authenticated"
            invalidBadge={isDataInvalid}
          />
        )}
        <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
      </div>
    </article>
  );
});
