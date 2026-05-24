import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Responsive, useContainerWidth } from "react-grid-layout";

import { createScaledStrategy, noCompactor } from "react-grid-layout/core";

const noCompactorPreventCollision = { ...noCompactor, preventCollision: true };

import { resolveDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { pushLayoutSnapshot } from "../../layout/state/layoutHistorySlice";
import { accumulatePanelUpdate } from "../state/panelsSlice";
import { useTheme } from "../../../theme/ThemeProvider";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { usePanelGridSave, type PanelGridSaveHandle } from "../hooks/usePanelGridSave";
import { PanelDetailModal } from "./PanelDetailModal";
import { PanelCard } from "./PanelCard";
import { createLayouts, fromResponsiveLayouts, panelGridConfig } from "./panelGridConfig";
import "./PanelGrid.css";

export type PanelGridHandle = PanelGridSaveHandle;

interface PanelGridProps {
  dashboardId: string;
  layout: DashboardLayout;
  panels: Panel[];
  zoomLevel?: number;
}

export const PanelGrid = React.forwardRef<PanelGridHandle, PanelGridProps>(function PanelGrid(
  { dashboardId, layout, panels, zoomLevel = 1.0 },
  ref,
) {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const [isDragging, setIsDragging] = useState(false);
  const [confirmDeletePanelId, setConfirmDeletePanelId] = useState<string | null>(null);
  const [detailPanelId, setDetailPanelId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingTitleError, setEditingTitleError] = useState<string | null>(null);
  const titleCancelledRef = useRef(false);
  // Ref so that commitTitleEdit can read the latest editingTitle without
  // being recreated on every keystroke (keeps onTitleKeyDown stable).
  const editingTitleRef = useRef(editingTitle);
  useEffect(() => {
    editingTitleRef.current = editingTitle;
  });
  const mousedownPos = useRef<{ x: number; y: number } | null>(null);
  const { containerRef, width } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
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
  const preInteractionLayoutRef = useRef<DashboardLayout | null>(null);

  const { latestLayoutRef, markLayoutChanged } = usePanelGridSave({
    dashboardId,
    resolvedLayout,
    forwardedRef: ref,
  });

  // ─── Stable title-editing callbacks ───────────────────────────────────────

  const cancelEditingTitle = useCallback(() => {
    titleCancelledRef.current = true;
    setEditingTitleId(null);
    setEditingTitleError(null);
  }, []);

  const commitTitleEdit = useCallback(
    (panelId: string) => {
      if (titleCancelledRef.current) return;
      const trimmed = editingTitleRef.current.trim();
      if (trimmed.length === 0) {
        setEditingTitleError("Title must not be blank.");
        return;
      }
      setEditingTitleId(null);
      setEditingTitleError(null);
      dispatch(accumulatePanelUpdate({ panelId, fields: { title: trimmed } }));
    },
    [dispatch],
  );

  const handleStartEdit = useCallback((panelId: string, currentTitle: string) => {
    setConfirmDeletePanelId(null);
    setDetailPanelId(null);
    setEditingTitleId(panelId);
    setEditingTitle(currentTitle);
    setEditingTitleError(null);
    titleCancelledRef.current = false;
  }, []);

  const handleTitleChange = useCallback((value: string) => {
    setEditingTitle(value);
    setEditingTitleError(null);
  }, []);

  const handleTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, panelId: string) => {
      if (event.key === "Enter") {
        commitTitleEdit(panelId);
      } else if (event.key === "Escape") {
        cancelEditingTitle();
      }
    },
    [commitTitleEdit, cancelEditingTitle],
  );

  const handleTitleBlur = useCallback(
    (panelId: string) => {
      commitTitleEdit(panelId);
    },
    [commitTitleEdit],
  );

  // ─── Stable card interaction callbacks ────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    mousedownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleCardClick = useCallback((panelId: string, e: React.MouseEvent<HTMLElement>) => {
    const pos = mousedownPos.current;
    if (pos !== null && Math.abs(e.clientX - pos.x) + Math.abs(e.clientY - pos.y) > 5) return;
    if ((e.target as Element).closest("button, input, a, .react-resizable-handle")) return;
    setDetailPanelId(panelId);
  }, []);

  const handleRequestDelete = useCallback((panelId: string) => {
    setConfirmDeletePanelId(panelId);
  }, []);

  const handleCancelDelete = useCallback(() => {
    setConfirmDeletePanelId(null);
  }, []);

  const handleDetail = useCallback((panelId: string) => {
    setDetailPanelId(panelId);
  }, []);

  // ─── 2.7 Stable drag callbacks ────────────────────────────────────────────

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
    preInteractionLayoutRef.current = latestLayoutRef.current;
  }, [latestLayoutRef]);

  const handleDragStop = useCallback(() => {
    setIsDragging(false);
    if (preInteractionLayoutRef.current !== null) {
      dispatch(
        pushLayoutSnapshot({
          dashboardId,
          layout: preInteractionLayoutRef.current,
        }),
      );
      preInteractionLayoutRef.current = null;
    }
  }, [dashboardId, dispatch]);

  const handleResizeStart = useCallback(() => {
    preInteractionLayoutRef.current = latestLayoutRef.current;
  }, [latestLayoutRef]);

  const handleResizeStop = useCallback(() => {
    if (preInteractionLayoutRef.current !== null) {
      dispatch(
        pushLayoutSnapshot({
          dashboardId,
          layout: preInteractionLayoutRef.current,
        }),
      );
      preInteractionLayoutRef.current = null;
    }
  }, [dashboardId, dispatch]);

  type LayoutChangeHandler = NonNullable<React.ComponentProps<typeof Responsive>["onLayoutChange"]>;
  const handleLayoutChange = useCallback<LayoutChangeHandler>(
    (_, nextLayouts) => {
      if (nextLayouts === undefined) return;
      markLayoutChanged(fromResponsiveLayouts(panels, nextLayouts));
    },
    [markLayoutChanged, panels],
  );

  return (
    <div ref={containerRef} className="panel-grid-shell">
      <Responsive
        className="panel-grid"
        width={width}
        layouts={layouts}
        breakpoints={panelGridConfig.breakpoints}
        cols={panelGridConfig.cols}
        rowHeight={panelGridConfig.rowHeight}
        margin={panelGridConfig.margin}
        containerPadding={panelGridConfig.containerPadding}
        dragConfig={{ handle: ".panel-grid-card__handle" }}
        compactor={noCompactorPreventCollision}
        positionStrategy={scaledPositionStrategy}
        onDragStart={handleDragStart}
        onResizeStart={handleResizeStart}
        onDragStop={handleDragStop}
        onResizeStop={handleResizeStop}
        onLayoutChange={handleLayoutChange}
      >
        {panels.map((panel) => {
          const isEditingTitle = editingTitleId === panel.id;
          const isConfirmingDelete = confirmDeletePanelId === panel.id;
          return (
            <div key={panel.id}>
              <PanelCard
                panel={panel}
                theme={theme}
                isDragging={isDragging}
                dashboardId={dashboardId}
                isEditingTitle={isEditingTitle}
                editingTitle={isEditingTitle ? editingTitle : ""}
                editingTitleError={isEditingTitle ? editingTitleError : null}
                isConfirmingDelete={isConfirmingDelete}
                onMouseDown={handleMouseDown}
                onCardClick={handleCardClick}
                onStartEdit={handleStartEdit}
                onTitleChange={handleTitleChange}
                onTitleKeyDown={handleTitleKeyDown}
                onTitleBlur={handleTitleBlur}
                onRequestDelete={handleRequestDelete}
                onCancelDelete={handleCancelDelete}
                onDetail={handleDetail}
              />
            </div>
          );
        })}
      </Responsive>
      {detailPanelId !== null ? (
        <PanelDetailModal
          panel={panels.find((p) => p.id === detailPanelId)!}
          onClose={() => setDetailPanelId(null)}
        />
      ) : null}
    </div>
  );
});
