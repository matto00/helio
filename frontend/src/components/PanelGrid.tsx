import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Responsive, type ResponsiveGridLayoutProps, useContainerWidth } from "react-grid-layout";
import { noCompactor } from "react-grid-layout/core";

import {
  areDashboardLayoutsEqual,
  dashboardGridCols,
  resolveDashboardLayout,
} from "../features/dashboards/dashboardLayout";
import { updateDashboardLayout } from "../features/dashboards/dashboardsSlice";
import { deletePanel } from "../features/panels/panelsSlice";
import { useAppDispatch } from "../hooks/reduxHooks";
import { buildPanelSurface, resolvePanelTextColor } from "../theme/appearance";
import { useTheme } from "../theme/ThemeProvider";
import type { DashboardLayout, Panel } from "../types/models";
import { ActionsMenu } from "./ActionsMenu";
import { PanelAppearanceEditor } from "./PanelAppearanceEditor";
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

interface PanelGridProps {
  dashboardId: string;
  layout: DashboardLayout;
  panels: Panel[];
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

export function PanelGrid({ dashboardId, layout, panels }: PanelGridProps) {
  const dispatch = useAppDispatch();
  const { theme } = useTheme();
  const [confirmDeletePanelId, setConfirmDeletePanelId] = useState<string | null>(null);
  const [customizePanelId, setCustomizePanelId] = useState<string | null>(null);
  const { containerRef, width } = useContainerWidth({
    initialWidth: panelGridConfig.initialWidth,
  });
  const resolvedLayout = useMemo(() => resolveDashboardLayout(panels, layout), [layout, panels]);
  const layouts = useMemo(() => createLayouts(resolvedLayout), [resolvedLayout]);
  const latestLayoutRef = useRef(resolvedLayout);
  const persistedLayoutRef = useRef(resolvedLayout);
  const inFlightLayoutRef = useRef<DashboardLayout | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        compactor={noCompactor}
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
                <div>
                  <h3 className="panel-grid-card__title">{panel.title}</h3>
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
                  ) : customizePanelId === panel.id ? (
                    <PanelAppearanceEditor
                      panel={panel}
                      isOpenExternal={true}
                      onClose={() => setCustomizePanelId(null)}
                    />
                  ) : (
                    <ActionsMenu
                      label={`${panel.title} panel actions`}
                      items={[
                        {
                          label: "Customize",
                          onClick: () => setCustomizePanelId(panel.id),
                        },
                        { label: "Duplicate", onClick: () => {}, disabled: true },
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
              <p className="panel-grid-card__copy">
                Starter grid placement is live now so future tickets can add richer panel content,
                saved layouts, and deeper customization without replacing the layout foundation.
              </p>
              <div className="panel-grid-card__footer">
                <span>Updated {new Date(panel.meta.lastUpdated).toLocaleDateString()}</span>
              </div>
            </article>
          </div>
        ))}
      </Responsive>
    </div>
  );
}
