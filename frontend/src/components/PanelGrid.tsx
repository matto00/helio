import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Responsive, type ResponsiveGridLayoutProps, useContainerWidth } from "react-grid-layout";

import { createScaledStrategy, noCompactor } from "react-grid-layout/core";

const noCompactorPreventCollision = { ...noCompactor, preventCollision: true };

import {
  areDashboardLayoutsEqual,
  dashboardGridCols,
  resolveDashboardLayout,
} from "../features/dashboards/dashboardLayout";
import { updateDashboardLayout } from "../features/dashboards/dashboardsSlice";
import { pushLayoutSnapshot } from "../features/layout/layoutHistorySlice";
import {
  accumulatePanelUpdate,
  buildBatchRequest,
  clearPendingPanelUpdates,
  deletePanel,
  duplicatePanel,
  resetPanelSaveState,
  updatePanelsBatch,
} from "../features/panels/panelsSlice";
import { buildPanelSurface, resolvePanelTextColor } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import type { DashboardLayout, Panel } from "../types/models";
import { ActionsMenu } from "./ActionsMenu";
import { InlineError } from "./InlineError";
import { PanelContent } from "./PanelContent";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { useAppDispatch, useAppSelector } from "../hooks/reduxHooks";
import { PanelDetailModal } from "./PanelDetailModal";
import { useSaveState } from "../context/SaveStateContext";
import "./PanelGrid.css";

interface PanelGridConfig {
  breakpoints: NonNullable<ResponsiveGridLayoutProps["breakpoints"]>;
  cols: NonNullable<ResponsiveGridLayoutProps["cols"]>;
  rowHeight: number;
  margin: readonly [number, number];
  containerPadding: readonly [number, number];
  initialWidth: number;
  itemHeights: {
    default: number;
    min: number;
  };
}

const panelGridConfig: PanelGridConfig = {
  breakpoints: {
    lg: 1440,
    md: 1100,
    sm: 768,
    xs: 0,
  },
  cols: dashboardGridCols,
  rowHeight: 52,
  margin: [18, 18],
  containerPadding: [0, 0],
  initialWidth: 1280,
  itemHeights: {
    default: 5,
    min: 4,
  },
};

function createLayouts(layout: DashboardLayout): NonNullable<ResponsiveGridLayoutProps["layouts"]> {
  return {
    lg: layout.lg.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: Math.min(2, item.w),
      minH: panelGridConfig.itemHeights.min,
    })),
    md: layout.md.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: Math.min(2, item.w),
      minH: panelGridConfig.itemHeights.min,
    })),
    sm: layout.sm.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: Math.min(2, item.w),
      minH: panelGridConfig.itemHeights.min,
    })),
    xs: layout.xs.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: 1,
      minH: panelGridConfig.itemHeights.min,
    })),
  };
}

export interface PanelGridHandle {
  /** Immediately flush pending panel updates and reset the auto-save timer. */
  flushAndReset: () => void;
}

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

function fromResponsiveLayouts(
  panels: Panel[],
  layouts: NonNullable<ResponsiveGridLayoutProps["layouts"]>,
): DashboardLayout {
  const panelIds = new Set(panels.map((panel) => panel.id));
  const toItems = (items: NonNullable<ResponsiveGridLayoutProps["layouts"]>[string] = []) =>
    items
      .filter((item) => panelIds.has(item.i))
      .map((item) => ({
        panelId: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }));

  return resolveDashboardLayout(panels, {
    lg: toItems(layouts.lg),
    md: toItems(layouts.md),
    sm: toItems(layouts.sm),
    xs: toItems(layouts.xs),
  });
}

interface PanelCardBodyProps {
  panel: Panel;
}

function PanelCardBody({ panel }: PanelCardBodyProps) {
  const dataTypes = useAppSelector((state) => state.dataTypes.items);
  const sources = useAppSelector((state) => state.sources);
  const { data, rawRows, headers, isLoading, error, noData, refresh } = usePanelData(
    panel,
    dataTypes,
    sources,
  );
  usePanelPolling(refresh, panel.refreshInterval, panel.typeId);
  return (
    <PanelContent
      type={panel.type}
      appearance={panel.appearance}
      data={data}
      rawRows={rawRows}
      headers={headers}
      fieldMapping={panel.fieldMapping}
      isLoading={isLoading}
      error={error}
      noData={noData}
      content={panel.content}
    />
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
  const { containerRef, width } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
  // positionStrategy with createScaledStrategy(zoomLevel) corrects drag and resize coordinate
  // offsets that arise when a CSS scale() transform is applied to the grid's ancestor element.
  // react-grid-layout@2.2.2 exposes positionStrategy as the modern replacement for the legacy
  // transformScale prop; createScaledStrategy() is the built-in factory for scale-aware
  // coordinate remapping.
  const scaledPositionStrategy = useMemo(() => createScaledStrategy(zoomLevel), [zoomLevel]);
  const resolvedLayout = useMemo(() => resolveDashboardLayout(panels, layout), [layout, panels]);
  const layouts = useMemo(() => createLayouts(resolvedLayout), [resolvedLayout]);
  const latestLayoutRef = useRef(resolvedLayout);
  const persistedLayoutRef = useRef(resolvedLayout);
  const inFlightLayoutRef = useRef<DashboardLayout | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelFlushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preInteractionLayoutRef = useRef<DashboardLayout | null>(null);
  const pendingPanelUpdates = useAppSelector((state) => state.panels.pendingPanelUpdates);
  // Keep a ref so the interval callback always reads the latest value without re-registering.
  const pendingPanelUpdatesRef = useRef(pendingPanelUpdates);
  useEffect(() => {
    pendingPanelUpdatesRef.current = pendingPanelUpdates;
  });

  useEffect(() => {
    latestLayoutRef.current = resolvedLayout;
    persistedLayoutRef.current = resolvedLayout;
    if (
      inFlightLayoutRef.current !== null &&
      areDashboardLayoutsEqual(inFlightLayoutRef.current, resolvedLayout)
    ) {
      inFlightLayoutRef.current = null;
    }
  }, [resolvedLayout]);

  useEffect(
    () => () => {
      if (persistTimerRef.current !== null) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    },
    [],
  );

  const persistLayout = useCallback(() => {
    const nextLayout = latestLayoutRef.current;
    if (areDashboardLayoutsEqual(nextLayout, persistedLayoutRef.current)) {
      return;
    }
    if (
      inFlightLayoutRef.current !== null &&
      areDashboardLayoutsEqual(nextLayout, inFlightLayoutRef.current)
    ) {
      return;
    }

    inFlightLayoutRef.current = nextLayout;
    void dispatch(updateDashboardLayout({ dashboardId, layout: nextLayout }))
      .unwrap()
      .catch(() => {
        // Keep local drag UX responsive; retry happens on the next layout change.
      })
      .finally(() => {
        if (
          inFlightLayoutRef.current !== null &&
          areDashboardLayoutsEqual(inFlightLayoutRef.current, nextLayout)
        ) {
          inFlightLayoutRef.current = null;
        }
      });
  }, [dashboardId, dispatch]);

  /** Flush all pending panel updates immediately. Shared by the interval and "Save now". */
  const flushPanelUpdates = useCallback(() => {
    const pending = pendingPanelUpdatesRef.current;
    if (Object.keys(pending).length === 0) return;
    void dispatch(updatePanelsBatch(buildBatchRequest(pending)))
      .unwrap()
      .then(() => {
        dispatch(clearPendingPanelUpdates());
      })
      .catch(() => {
        // Network or server error — retain pending updates; next interval tick retries
      });
  }, [dispatch]);

  /** Flush immediately and reset the 30-second auto-save timer. Used by "Save now". */
  const flushAndReset = useCallback(() => {
    flushPanelUpdates();
    persistLayout();
    if (panelFlushTimerRef.current !== null) {
      clearInterval(panelFlushTimerRef.current);
    }
    panelFlushTimerRef.current = setInterval(flushPanelUpdates, 30_000);
  }, [flushPanelUpdates, persistLayout]);

  // Start a 30-second auto-save interval on mount; cancel on unmount.
  useEffect(() => {
    panelFlushTimerRef.current = setInterval(flushPanelUpdates, 30_000);
    return () => {
      if (panelFlushTimerRef.current !== null) {
        clearInterval(panelFlushTimerRef.current);
        panelFlushTimerRef.current = null;
      }
    };
  }, [flushPanelUpdates]);

  // Reset save state when the user switches to a different dashboard.
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    flushPanelUpdates();
    dispatch(resetPanelSaveState());
    if (panelFlushTimerRef.current !== null) {
      clearInterval(panelFlushTimerRef.current);
    }
    panelFlushTimerRef.current = setInterval(flushPanelUpdates, 30_000);
  }, [dashboardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Register the flush+reset function with the context so AppShell can invoke it.
  const { registerFlush } = useSaveState();
  useEffect(() => {
    registerFlush(flushAndReset);
    return () => registerFlush(null);
  }, [registerFlush, flushAndReset]);

  /**
   * Expose an imperative handle so callers with a ref can also trigger flush+reset.
   */
  useImperativeHandle(ref, () => ({ flushAndReset }), [flushAndReset]);

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
          latestLayoutRef.current = fromResponsiveLayouts(panels, nextLayouts);
          if (persistTimerRef.current !== null) {
            clearTimeout(persistTimerRef.current);
          }
          persistTimerRef.current = setTimeout(() => {
            persistTimerRef.current = null;
            persistLayout();
          }, 250);
        }}
      >
        {panels.map((panel) => (
          <div key={panel.id}>
            <article className="panel-grid-card" style={getPanelCardStyle(panel, theme)}>
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
