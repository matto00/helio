import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Responsive, useContainerWidth } from "react-grid-layout";

import { createScaledStrategy, noCompactor } from "react-grid-layout/core";

const noCompactorPreventCollision = { ...noCompactor, preventCollision: true };

import { resolveDashboardLayout } from "../features/dashboards/dashboardLayout";
import { pushLayoutSnapshot } from "../features/layout/layoutHistorySlice";
import {
  accumulatePanelUpdate,
  deletePanel,
  duplicatePanel,
  fetchPanelPage,
} from "../features/panels/panelsSlice";
import { buildPanelSurface, resolvePanelTextColor } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import type { DashboardLayout, Panel } from "../types/models";
import { getDataTypeId } from "../features/panels/panelNarrowing";
import { ActionsMenu } from "./ActionsMenu";
import { InlineError } from "./InlineError";
import { PanelContent } from "./PanelContent";
import { useLegacyBoundPanel } from "../hooks/useLegacyBoundPanel";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { usePanelGridSave, type PanelGridSaveHandle } from "../hooks/usePanelGridSave";
import { PanelDetailModal } from "./PanelDetailModal";
import { PanelLegacyWarning } from "./PanelLegacyWarning";
import { createLayouts, fromResponsiveLayouts, panelGridConfig } from "./panelGridConfig";
import "./PanelGrid.css";

export type PanelGridHandle = PanelGridSaveHandle;

interface PanelGridProps {
  dashboardId: string;
  layout: DashboardLayout;
  panels: Panel[];
  zoomLevel?: number;
}

function getPanelCardStyle(panel: Panel, theme: "dark" | "light"): CSSProperties {
  const style = {} as CSSProperties & Record<string, string>;
  const panelSurface = buildPanelSurface(
    theme,
    panel.appearance.background,
    panel.appearance.transparency,
  );
  style["--panel-surface-override"] = panelSurface;
  style["--panel-text-override"] = resolvePanelTextColor(
    theme,
    panel.appearance.background,
    panel.appearance.transparency,
    panel.appearance.color,
  );

  return style;
}

interface PanelCardBodyProps {
  panel: Panel;
}

function PanelCardBody({ panel }: PanelCardBodyProps) {
  const dispatch = useAppDispatch();
  const paginationEntry = useAppSelector((state) => state.panels.paginationState[panel.id]);
  const { data, rawRows, headers, isLoading, error, noData, refresh } = usePanelData(panel);
  usePanelPolling(refresh, panel.refreshInterval ?? null, getDataTypeId(panel));
  const isLegacyBound = useLegacyBoundPanel(panel);

  const handleLoadMore = useCallback(() => {
    if (paginationEntry && !paginationEntry.isLoadingMore) {
      void dispatch(
        fetchPanelPage({
          panelId: panel.id,
          page: paginationEntry.currentPage + 1,
          pageSize: 50,
        }),
      );
    }
  }, [dispatch, panel.id, paginationEntry]);

  // For table panels, determine loading from pagination state (initial load)
  const tableIsLoading =
    panel.type === "table" &&
    paginationEntry != null &&
    paginationEntry.isLoadingMore &&
    paginationEntry.rows.length === 0;

  return (
    <>
      {isLegacyBound && <PanelLegacyWarning />}
      <PanelContent
        panel={panel}
        appearance={panel.appearance}
        data={data}
        rawRows={rawRows}
        headers={headers}
        isLoading={panel.type === "table" ? tableIsLoading : isLoading}
        error={error}
        noData={noData}
        paginationRows={paginationEntry?.rows ?? null}
        paginationHasMore={paginationEntry?.hasMore ?? false}
        paginationIsLoadingMore={paginationEntry?.isLoadingMore ?? false}
        onLoadMore={handleLoadMore}
      />
    </>
  );
}

export const PanelGrid = React.forwardRef<PanelGridHandle, PanelGridProps>(function PanelGrid(
  { dashboardId, layout, panels, zoomLevel = 1.0 },
  ref,
) {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const [confirmDeletePanelId, setConfirmDeletePanelId] = useState<string | null>(null);
  const [detailPanelId, setDetailPanelId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingTitleError, setEditingTitleError] = useState<string | null>(null);
  const titleCancelledRef = useRef(false);
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

  function startEditingTitle(panelId: string, currentTitle: string) {
    setConfirmDeletePanelId(null);
    setDetailPanelId(null);
    setEditingTitleId(panelId);
    setEditingTitle(currentTitle);
    setEditingTitleError(null);
    titleCancelledRef.current = false;
  }

  function cancelEditingTitle() {
    titleCancelledRef.current = true;
    setEditingTitleId(null);
    setEditingTitleError(null);
  }

  function commitTitleEdit(panelId: string) {
    if (titleCancelledRef.current) return;
    const trimmed = editingTitle.trim();
    if (trimmed.length === 0) {
      setEditingTitleError("Title must not be blank.");
      return;
    }
    setEditingTitleId(null);
    setEditingTitleError(null);
    dispatch(accumulatePanelUpdate({ panelId, fields: { title: trimmed } }));
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>, panelId: string) {
    if (event.key === "Enter") {
      commitTitleEdit(panelId);
    } else if (event.key === "Escape") {
      cancelEditingTitle();
    }
  }

  function handlePanelCardMouseDown(e: React.MouseEvent<HTMLElement>) {
    mousedownPos.current = { x: e.clientX, y: e.clientY };
  }

  function handlePanelCardClick(panelId: string, e: React.MouseEvent<HTMLElement>) {
    const pos = mousedownPos.current;
    if (pos !== null && Math.abs(e.clientX - pos.x) + Math.abs(e.clientY - pos.y) > 5) return;
    if ((e.target as Element).closest("button, input, a, .react-resizable-handle")) return;
    setDetailPanelId(panelId);
  }

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
        onDragStart={() => {
          preInteractionLayoutRef.current = latestLayoutRef.current;
        }}
        onResizeStart={() => {
          preInteractionLayoutRef.current = latestLayoutRef.current;
        }}
        onDragStop={() => {
          if (preInteractionLayoutRef.current !== null) {
            dispatch(
              pushLayoutSnapshot({
                dashboardId,
                layout: preInteractionLayoutRef.current,
              }),
            );
            preInteractionLayoutRef.current = null;
          }
        }}
        onResizeStop={() => {
          if (preInteractionLayoutRef.current !== null) {
            dispatch(
              pushLayoutSnapshot({
                dashboardId,
                layout: preInteractionLayoutRef.current,
              }),
            );
            preInteractionLayoutRef.current = null;
          }
        }}
        onLayoutChange={(_, nextLayouts) => {
          if (nextLayouts === undefined) {
            return;
          }
          markLayoutChanged(fromResponsiveLayouts(panels, nextLayouts));
        }}
      >
        {panels.map((panel) => (
          <div key={panel.id}>
            <article
              className="panel-grid-card"
              style={getPanelCardStyle(panel, theme)}
              onMouseDown={handlePanelCardMouseDown}
              onClick={(e) => handlePanelCardClick(panel.id, e)}
            >
              <div className="panel-grid-card__top">
                <div className="panel-grid-card__title-area">
                  {editingTitleId === panel.id ? (
                    <>
                      <input
                        className="panel-grid-card__title-input"
                        type="text"
                        value={editingTitle}
                        autoFocus
                        aria-label="Panel title"
                        onChange={(e) => {
                          setEditingTitle(e.target.value);
                          setEditingTitleError(null);
                        }}
                        onKeyDown={(e) => handleTitleKeyDown(e, panel.id)}
                        onBlur={() => commitTitleEdit(panel.id)}
                      />
                      <InlineError error={editingTitleError} />
                    </>
                  ) : (
                    <h3 className="panel-grid-card__title">{panel.title}</h3>
                  )}
                </div>
                <div className="panel-grid-card__actions">
                  {confirmDeletePanelId === panel.id ? (
                    <>
                      <button
                        type="button"
                        className="panel-grid-card__delete-confirm-btn"
                        onClick={() => {
                          void dispatch(deletePanel({ panelId: panel.id, dashboardId }));
                          setConfirmDeletePanelId(null);
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="panel-grid-card__delete-cancel-btn"
                        onClick={() => setConfirmDeletePanelId(null)}
                      >
                        ×
                      </button>
                    </>
                  ) : editingTitleId === panel.id ? null : (
                    <ActionsMenu
                      label={`${panel.title} panel actions`}
                      items={[
                        {
                          label: "Rename",
                          onClick: () => startEditingTitle(panel.id, panel.title),
                        },
                        {
                          label: "Customize",
                          onClick: () => setDetailPanelId(panel.id),
                        },
                        {
                          label: "Duplicate",
                          onClick: () =>
                            void dispatch(duplicatePanel({ panelId: panel.id, dashboardId })),
                        },
                        {
                          label: "Delete",
                          onClick: () => setConfirmDeletePanelId(panel.id),
                          danger: true,
                        },
                      ]}
                    />
                  )}
                  <button
                    type="button"
                    className="panel-grid-card__handle"
                    aria-label={`Move ${panel.title} panel`}
                  >
                    <span />
                    <span />
                  </button>
                </div>
              </div>
              <PanelCardBody panel={panel} />
              <div className="panel-grid-card__footer">
                <span className="panel-grid-card__type-badge">{panel.type}</span>
                <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
              </div>
            </article>
          </div>
        ))}
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
