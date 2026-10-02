// Static configuration + pure layout helpers for `PanelGrid`.
//
// Extracted from `PanelGrid.tsx` to keep the component file under the size
// cap; nothing here touches React or Redux state.

import type { ResponsiveGridLayoutProps } from "react-grid-layout";

import { dashboardGridCols } from "../../../dashboards/state/dashboardLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../../../dashboards/types/dashboard";
import type { Panel } from "../../types/panel";

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

/** RGL's `getBreakpointFromWidth` is strict (`width > breakpoint`), while `PanelGrid`'s phone-stack
 *  boundary and the documented breakpoints are inclusive (`>=`): a container of exactly 1440, 1100 or
 *  768px would resolve one breakpoint low (768px mounted RGL at 2 columns). Shifting each boundary
 *  down by 0.001px makes strict equal inclusive for every real (pixel-rounded) width. Pass THESE to
 *  `Responsive` and to any `getBreakpointFromWidth` call, never `panelGridConfig.breakpoints`. */
const BOUNDARY_EPSILON = 0.001;
export const rglBreakpoints: PanelGridConfig["breakpoints"] = Object.fromEntries(
  Object.entries(panelGridConfig.breakpoints).map(([bp, min]) => [
    bp,
    min > 0 ? min - BOUNDARY_EPSILON : min,
  ]),
);

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

/** Reads one breakpoint's items out of an RGL layout, in panel order, dropping ids that are not live
 *  panels. Called by RGL's onLayoutChange on every drag tick, so it must stay cheap. RGL already
 *  produces a non-overlapping layout (preventCollision: true), so no resolving happens here. */
export function itemsFromRglLayout(
  panels: Panel[],
  layout: readonly { i: string; x: number; y: number; w: number; h: number }[],
): DashboardLayoutItem[] {
  const byId = new Map(layout.map((item) => [item.i, item]));
  const items: DashboardLayoutItem[] = [];
  for (const panel of panels) {
    const item = byId.get(panel.id);
    if (item) items.push({ panelId: item.i, x: item.x, y: item.y, w: item.w, h: item.h });
  }
  return items;
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
