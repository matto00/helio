// Static configuration + pure layout helpers for `PanelGrid`.
//
// Extracted from `PanelGrid.tsx` to keep the component file under the size
// cap; nothing here touches React or Redux state.

import type { ResponsiveGridLayoutProps } from "react-grid-layout";

import { dashboardGridCols } from "../../dashboards/state/dashboardLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../../dashboards/types/dashboard";
import type { Panel } from "../types/panel";

export interface PanelGridConfig {
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

export const panelGridConfig: PanelGridConfig = {
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

export function createLayouts(
  layout: DashboardLayout,
): NonNullable<ResponsiveGridLayoutProps["layouts"]> {
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

export function fromResponsiveLayouts(
  panels: Panel[],
  layouts: NonNullable<ResponsiveGridLayoutProps["layouts"]>,
): DashboardLayout {
  // Called by RGL's onLayoutChange on every drag tick. Must stay cheap.
  // RGL already produces a non-overlapping layout (preventCollision:true), so
  // we just read items out — no need to re-run the full resolveDashboardLayout
  // (which rebuilds fallback layouts for all 4 breakpoints and is too heavy
  // for the drag hot path).
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

  return {
    lg: toItems(layouts.lg),
    md: toItems(layouts.md),
    sm: toItems(layouts.sm),
    xs: toItems(layouts.xs),
  };
}

/** Orders panels for the phone read-only stack (HEL-301, mobile-viewer-stack
 *  spec): resolved `xs` layout `y` ascending, breaking ties by `x` ascending.
 *  `xsLayout` is expected to carry an entry for every panel — callers pass
 *  `resolveDashboardLayout(...).xs`, whose fallback placement guarantees this
 *  — but a panel with no entry sorts last rather than crashing, defensively. */
export function orderPanelsForMobileStack(
  panels: Panel[],
  xsLayout: DashboardLayoutItem[],
): Panel[] {
  const positionById = new Map(xsLayout.map((item) => [item.panelId, item]));
  return [...panels].sort((a, b) => {
    const posA = positionById.get(a.id);
    const posB = positionById.get(b.id);
    if (!posA && !posB) return 0;
    if (!posA) return 1;
    if (!posB) return -1;
    if (posA.y !== posB.y) return posA.y - posB.y;
    return posA.x - posB.x;
  });
}
