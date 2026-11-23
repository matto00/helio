// Static configuration + pure layout helpers for `PanelGrid`.
//
// Extracted from `PanelGrid.tsx` to keep the component file under the size
// cap; nothing here touches React or Redux state.

import type { ResponsiveGridLayoutProps } from "react-grid-layout";

import { dashboardGridCols } from "../../../dashboards/state/dashboardLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../../../dashboards/types/dashboard";
import type { Density } from "../../../../theme/appearancePrefs";
import type { Panel } from "../../types/panel";
import { isCompactCounterConfig } from "../form/compactCounter";

/** The Compact gutter (HEL-1572). Mirrors `:root[data-density="compact"] --density-grid-gap`. */
export const COMPACT_GRID_GUTTER_PX = 8;

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

/** Desktop grid gutter in px, horizontal and vertical. Must equal the `--space-3` token (12px, DESIGN.md
 *  §9 "Dashboard grid gutter"); `panelGridConfig.test.ts` parses `theme.css` so the two cannot drift. It is also the
 *  Comfortable `--density-grid-gap` (guarded by `theme/appearanceTokens.css.test.ts`). */
export const GRID_GUTTER_PX = 12;

export const panelGridConfig: PanelGridConfig = {
  breakpoints: {
    lg: 1440,
    md: 1100,
    sm: 768,
    xs: 0,
  },
  cols: dashboardGridCols,
  rowHeight: 52,
  margin: [GRID_GUTTER_PX, GRID_GUTTER_PX],
  containerPadding: [0, 0],
  initialWidth: 1280,
  itemHeights: {
    default: 5,
    min: 4,
  },
};

/** The density-dependent react-grid-layout metrics (HEL-1572). RGL lays a panel out at top `y·(rowHeight + margin)`
 *  with height `h·rowHeight + (h−1)·margin`, so Compact adds the gutter difference d to `rowHeight`: the row step
 *  `rowHeight + margin` is identical in both densities, panel tops never move (a shared dashboard looks the same to
 *  every viewer), and every panel is exactly d taller (h·d − (h−1)·d), whatever its height. */
export function gridMetrics(density: Density): {
  rowHeight: number;
  margin: readonly [number, number];
} {
  const gutter = density === "compact" ? COMPACT_GRID_GUTTER_PX : GRID_GUTTER_PX;
  return {
    rowHeight: panelGridConfig.rowHeight + (GRID_GUTTER_PX - gutter),
    margin: [gutter, gutter],
  };
}

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

/** HEL-1618: the fewest rows a form panel (other than a compact counter) may be placed or resized to; matches the backend
 *  packer's `Form minH = 5` (`PanelPacker.scala`). */
export const FORM_MIN_ROWS = 5;

/** The fewest rows `panel` may be resized to, given its stored height `h` (HEL-1618, owner rulings `min-height-5-rows`
 *  and `lift-when-free`). A non-counter form already at 5+ rows gets the strict `FORM_MIN_ROWS`; a form saved below 5
 *  keeps today's general minimum so it resizes as before and RGL never bumps or collision-reverts it; a compact
 *  counter and every other kind keep the general minimum. A form with no fields or no config counts as a plain form,
 *  as the backend packer treats it. */
export function panelMinRows(panel: Panel | undefined, h: number): number {
  if (panel?.type !== "form" || isCompactCounterConfig(panel.config)) {
    return panelGridConfig.itemHeights.min;
  }
  return h >= FORM_MIN_ROWS ? FORM_MIN_ROWS : panelGridConfig.itemHeights.min;
}

/** True when no OTHER item of `items` (the FULL stored breakpoint, kept items of unloaded panels included) occupies a
 *  cell in `target`'s columns on rows `target.y + target.h` .. `target.y + rows - 1`. There is no bottom edge: the
 *  grid grows downward. */
export function isSpaceBelowFree(
  items: DashboardLayoutItem[],
  target: DashboardLayoutItem,
  rows: number,
): boolean {
  const top = target.y + target.h;
  const bottom = target.y + rows;
  return !items.some(
    (other) =>
      other.panelId !== target.panelId &&
      other.x < target.x + target.w &&
      other.x + other.w > target.x &&
      other.y < bottom &&
      other.y + other.h > top,
  );
}

/** HEL-1618 `lift-when-free`: when a resize of `resizedId` ends with a non-counter form below `FORM_MIN_ROWS`, grow it
 *  to `FORM_MIN_ROWS` only if the space directly below is free; otherwise keep it. No other item moves. Returns `items`
 *  itself when nothing lifts. */
export function liftResizedForm(
  items: DashboardLayoutItem[],
  resizedId: string | null,
  panels: Panel[],
): DashboardLayoutItem[] {
  if (resizedId === null) return items;
  const target = items.find((item) => item.panelId === resizedId);
  const panel = panels.find((p) => p.id === resizedId);
  if (!target || panel?.type !== "form" || isCompactCounterConfig(panel.config)) return items;
  if (target.h >= FORM_MIN_ROWS || !isSpaceBelowFree(items, target, FORM_MIN_ROWS)) return items;
  return items.map((item) => (item === target ? { ...item, h: FORM_MIN_ROWS } : item));
}

export function createLayouts(
  layout: DashboardLayout,
  minRowsFor: (panelId: string, h: number) => number = () => panelGridConfig.itemHeights.min,
): NonNullable<ResponsiveGridLayoutProps["layouts"]> {
  return {
    lg: layout.lg.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: Math.min(2, item.w),
      minH: minRowsFor(item.panelId, item.h),
    })),
    md: layout.md.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: Math.min(2, item.w),
      minH: minRowsFor(item.panelId, item.h),
    })),
    sm: layout.sm.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: Math.min(2, item.w),
      minH: minRowsFor(item.panelId, item.h),
    })),
    xs: layout.xs.map((item) => ({
      i: item.panelId,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      minW: 1,
      minH: minRowsFor(item.panelId, item.h),
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
