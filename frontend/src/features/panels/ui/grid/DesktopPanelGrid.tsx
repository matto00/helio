// The React Grid Layout grid — drag/resize/edit, layout persistence, and the
// ≥768px (`panelGridConfig.breakpoints.sm`) presentation.
//
// HEL-301 / HEL-304: extracted from `PanelGrid.tsx`, which measures the
// container, branches between this component and `MobilePanelStack`, and owns
// the width-independent panel-update flush (`usePanelUpdatesFlush`). Layout
// persistence lives in `useLayoutSave` (the layout half of the former
// `usePanelGridSave`) and is called *only* here — `MobilePanelStack` never
// imports it — so there is no code path capable of dispatching
// `updateDashboardLayout` / `setLayoutPending` below the `sm` boundary
// (hazard §4.1 of notes/mobile-pwa-handoff.md). `useLayoutSave` registers its
// `persistLayout` into the parent flush slot on mount and clears it on
// unmount, so crossing below the boundary leaves no layout-write path. Do not
// add a call to `useLayoutSave` (or anything that dispatches
// `updateDashboardLayout` / `setLayoutPending`) outside this file without
// re-reading that hazard section first.
//
// HEL-306: because this component fully unmounts when the width drops below the
// `sm` boundary (or on a dashboard switch — `PanelList.tsx` keys `<PanelGrid>`
// by `selectedDashboardId`, a true remount), `useLayoutSave` also flushes any
// staged-but-unpersisted layout change in its unmount cleanup, so a
// desktop-staged drag/resize is not dropped by the shell swap. This stays
// inside the desktop-only hook and runs on desktop-staged data only, so the
// HEL-301 structural guarantee is unchanged.

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useMemo } from "react";
import { Responsive } from "react-grid-layout";

import { createScaledStrategy, noCompactor } from "react-grid-layout/core";

const noCompactorPreventCollision = { ...noCompactor, preventCollision: true };

import { resolveDashboardLayout } from "../../../dashboards/state/dashboardLayout";
import { useTheme } from "../../../../theme/ThemeProvider";
import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import type { Panel } from "../../types/panel";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { useLayoutSave } from "../../hooks/useLayoutSave";
import type { LayoutFlush } from "../../hooks/usePanelUpdatesFlush";
import { PanelDetailModal } from "../detailModal/PanelDetailModal";
import { PanelCard } from "../PanelCard";
import { createLayouts, panelGridConfig, rglBreakpoints } from "./panelGridConfig";
import "./PanelGrid.css";
import { useCommitFlag } from "./useCommitFlag";
import { useGridLayoutInteraction } from "./useGridLayoutInteraction";
import { usePanelDetailState } from "./usePanelDetailState";
import { usePanelTitleEditing } from "./usePanelTitleEditing";
import { useProcessedWidth } from "./useProcessedWidth";

interface DesktopPanelGridProps {
  dashboardId: string;
  layout: DashboardLayout;
  /** HEL-1457: the store's `layoutVersion` paired with `layout`; see `useLayoutSave`. */
  layoutVersion?: number;
  panels: Panel[];
  zoomLevel: number;
  /** Grid container width, measured by the parent `PanelGrid`. */
  width: number;
  /** Registers this grid's layout-flush into the parent's width-independent
   *  flush slot (`usePanelUpdatesFlush`). Cleared automatically on unmount. */
  registerLayoutFlush: (fn: LayoutFlush) => void;
}

export function DesktopPanelGrid({
  dashboardId,
  layout,
  layoutVersion,
  panels,
  zoomLevel,
  width,
  registerLayoutFlush,
}: DesktopPanelGridProps) {
  // HEL-651: gate the auto-close effect (in `usePanelDetailState`) on the panels-list load state,
  // not just `panels` itself — `fetchPanels.rejected` empties `items` on a
  // *transient refetch failure*, indistinguishable from a real deletion by
  // list contents alone. See design.md's Decision (design-gate round 2).
  const panelsStatus = useAppSelector((state) => state.panels.status);
  const { theme } = useTheme();
  // HEL-1418: hook DECLARATION ORDER is load-bearing (effects run, and clean up, in declaration
  // order): title editing, detail state, the commit flag (its cleanup stays before
  // `useLayoutSave`'s unmount flush), `useLayoutSave`, then the hooks that consume its outputs as
  // plain arguments.
  const title = usePanelTitleEditing();
  const detail = usePanelDetailState(panels, panelsStatus, title.beginTitleEdit);
  // positionStrategy with createScaledStrategy(zoomLevel) corrects drag and resize coordinate
  // offsets that arise when a CSS scale() transform is applied to the grid's ancestor element.
  // react-grid-layout@2.2.2 exposes positionStrategy as the modern replacement for the legacy
  // transformScale prop; createScaledStrategy() is the built-in factory for scale-aware
  // coordinate remapping.
  //
  // Important: createScaledStrategy returns the dragged item's *viewport-absolute*
  // position as the drag baseline (clientRect.left / scale), but RGL's pointer-move
  // handler adds the cursor delta directly to that baseline as if it were
  // *parent-relative*. The default code path correctly subtracts the parent rect.
  // Using the scaled strategy at zoom=1 therefore introduces a constant jump of
  // parentRect.left/top on drag start. Fall back to the default strategy whenever
  // there is no actual scale to correct for.
  const scaledPositionStrategy = useMemo(
    () => (zoomLevel === 1 ? undefined : createScaledStrategy(zoomLevel)),
    [zoomLevel],
  );
  const resolvedLayout = useMemo(() => resolveDashboardLayout(panels, layout), [layout, panels]);
  const layouts = useMemo(() => createLayouts(resolvedLayout), [resolvedLayout]);

  const { commitOnNextLayoutChangeRef, clearCommitFlag, armCommitFlag } = useCommitFlag();
  const { latestLayoutRef, markLayoutChanged, commitInteractionLayout } = useLayoutSave({
    dashboardId,
    layout,
    layoutVersion,
    panels,
    panelsLoaded: panelsStatus === "succeeded",
    registerLayoutFlush,
  });
  const interaction = useGridLayoutInteraction({
    dashboardId,
    layout,
    resolvedLayout,
    panels,
    width,
    latestLayoutRef,
    markLayoutChanged,
    commitInteractionLayout,
    commitOnNextLayoutChangeRef,
    clearCommitFlag,
    armCommitFlag,
  });
  const { gridStyle, handleWidthChange } = useProcessedWidth(width);

  return (
    <>
      <Responsive
        className="panel-grid"
        width={width}
        style={gridStyle}
        onWidthChange={handleWidthChange}
        layouts={layouts}
        breakpoints={rglBreakpoints}
        cols={panelGridConfig.cols}
        rowHeight={panelGridConfig.rowHeight}
        margin={panelGridConfig.margin}
        containerPadding={panelGridConfig.containerPadding}
        dragConfig={{ handle: ".panel-grid-card__handle" }}
        compactor={noCompactorPreventCollision}
        positionStrategy={scaledPositionStrategy}
        onDragStart={interaction.handleDragStart}
        onResizeStart={interaction.handleResizeStart}
        onDragStop={interaction.handleDragStop}
        onResizeStop={interaction.handleResizeStop}
        onLayoutChange={interaction.handleLayoutChange}
      >
        {panels.map((panel) => {
          const isEditingTitle = title.editingTitleId === panel.id;
          const isConfirmingDelete = detail.confirmDeletePanelId === panel.id;
          return (
            <div key={panel.id}>
              <PanelCard
                panel={panel}
                theme={theme}
                isDragging={interaction.isDragging}
                dashboardId={dashboardId}
                isEditingTitle={isEditingTitle}
                editingTitle={isEditingTitle ? title.editingTitle : ""}
                editingTitleError={isEditingTitle ? title.editingTitleError : null}
                isConfirmingDelete={isConfirmingDelete}
                onMouseDown={detail.handleMouseDown}
                onCardClick={detail.handleCardClick}
                onStartEdit={detail.handleStartEdit}
                onTitleChange={title.handleTitleChange}
                onTitleKeyDown={title.handleTitleKeyDown}
                onTitleBlur={title.handleTitleBlur}
                onRequestDelete={detail.handleRequestDelete}
                onCancelDelete={detail.handleCancelDelete}
                onDetail={detail.handleDetail}
              />
            </div>
          );
        })}
      </Responsive>
      {detail.detailPanel ? (
        <PanelDetailModal
          // HEL-307: key by panel id so a direct switch between panels remounts
          // the modal subtree, re-seeding every `useState(initial*)` form field
          // from the target panel. Without it React reuses the instance and Save
          // could write the previous panel's staged values onto this one.
          key={detail.detailPanelId}
          panel={detail.detailPanel}
          onClose={detail.closeDetail}
          initialMode={detail.detailPanelMode}
        />
      ) : null}
    </>
  );
}
