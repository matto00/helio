import type { ResponsiveGridLayoutProps } from "react-grid-layout";

import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";
import {
  breakpointOrder,
  compactLayout,
  findOverlaps,
  isItemInBounds,
  nearestAuthoredBreakpoint,
  placeAround,
  scaleLayoutItem,
  type BreakpointKey,
} from "./breakpointLayout";

export { scaleLayoutItem };

export const dashboardLayoutBreakpoints = ["lg", "md", "sm", "xs"] as const;

export type DashboardLayoutBreakpoint = (typeof dashboardLayoutBreakpoints)[number];

export const dashboardGridCols: NonNullable<ResponsiveGridLayoutProps["cols"]> = {
  lg: 12,
  md: 10,
  sm: 6,
  xs: 2,
};

const defaultItemHeight = 5;

export const defaultDashboardLayout: DashboardLayout = {
  lg: [],
  md: [],
  sm: [],
  xs: [],
};

function findNextAvailablePosition(
  placed: DashboardLayoutItem[],
  colCount: number,
  itemWidth: number,
  itemHeight: number,
): { x: number; y: number } {
  const maxBottom = placed.reduce((max, item) => Math.max(max, item.y + item.h), 0);

  for (let y = 0; y <= maxBottom; y++) {
    for (let x = 0; x <= colCount - itemWidth; x++) {
      const overlaps = placed.some(
        (item) =>
          x < item.x + item.w &&
          x + itemWidth > item.x &&
          y < item.y + item.h &&
          y + itemHeight > item.y,
      );
      if (!overlaps) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: maxBottom };
}

function defaultItemWidth(colCount: number): number {
  return colCount >= 10 ? 4 : colCount >= 6 ? 3 : 2;
}

function createBaseLayout(panels: Panel[], colCount: number): DashboardLayoutItem[] {
  const itemWidth = defaultItemWidth(colCount);
  const placed: DashboardLayoutItem[] = [];

  for (const panel of panels) {
    const { x, y } = findNextAvailablePosition(placed, colCount, itemWidth, defaultItemHeight);
    const item: DashboardLayoutItem = {
      panelId: panel.id,
      x,
      y,
      w: itemWidth,
      h: defaultItemHeight,
    };
    placed.push(item);
  }

  return placed;
}

export function createFallbackDashboardLayout(panels: Panel[]): DashboardLayout {
  return {
    lg: createBaseLayout(panels, dashboardGridCols.lg),
    md: createBaseLayout(panels, dashboardGridCols.md),
    sm: createBaseLayout(panels, dashboardGridCols.sm),
    xs: createBaseLayout(panels, dashboardGridCols.xs),
  };
}

function sanitizeLayoutItem(item: DashboardLayoutItem): DashboardLayoutItem {
  return {
    panelId: item.panelId,
    x: Math.max(0, item.x),
    y: Math.max(0, item.y),
    w: Math.max(1, item.w),
    h: Math.max(1, item.h),
  };
}

/** One breakpoint's saved entries restricted to live panel ids (first entry per id wins, blank ids
 * dropped), sanitized. Stale ids (panels of another board or since deleted) never count. */
function liveEntries(saved: DashboardLayoutItem[], liveIds: Set<string>): DashboardLayoutItem[] {
  const seen = new Set<string>();
  const out: DashboardLayoutItem[] = [];
  for (const item of saved) {
    if (item.panelId.trim().length === 0 || !liveIds.has(item.panelId) || seen.has(item.panelId))
      continue;
    seen.add(item.panelId);
    out.push(sanitizeLayoutItem(item));
  }
  return out;
}

/** Step a/b of the per-breakpoint resolution (see `resolveDashboardLayout`): the anchors a breakpoint
 * keeps. Any entry outside the column bounds is evidence the data was authored at another column
 * count, so the breakpoint is unauthored (no anchors). Otherwise the entries are anchors, made
 * overlap-free in place when they collide. */
function anchorsFor(entries: DashboardLayoutItem[], cols: number): DashboardLayoutItem[] {
  if (!entries.every((item) => isItemInBounds(item, cols))) return [];
  return findOverlaps(entries).length === 0 ? entries : compactLayout(entries, cols);
}

/** Resolves the layout every breakpoint renders, as a pure function of `(panels, savedLayout)`.
 *
 * Per breakpoint, with fixed precedence (HEL-1023):
 *  a. a saved entry outside the column bounds makes the breakpoint unauthored: every panel is derived;
 *  b. otherwise the saved entries are anchors, compacted in place if they overlap each other;
 *  c. when every live panel has an anchor and they never overlapped, the saved layout is returned
 *     unchanged (gaps kept, never compacted);
 *  d. each panel without an anchor is scaled from the nearest other breakpoint that holds it (default
 *     size when none does) and placed in free space without moving an anchor.
 * Nothing here is ever persisted: callers persist a breakpoint only on a user edit at it. */
export function resolveDashboardLayout(
  panels: Panel[],
  savedLayout: DashboardLayout,
): DashboardLayout {
  const liveIds = new Set(panels.map((panel) => panel.id));
  const anchors = {} as Record<BreakpointKey, DashboardLayoutItem[]>;
  for (const bp of breakpointOrder) {
    anchors[bp] = anchorsFor(liveEntries(savedLayout[bp], liveIds), dashboardGridCols[bp]);
  }

  const resolveFor = (bp: BreakpointKey): DashboardLayoutItem[] => {
    const cols = dashboardGridCols[bp];
    const own = new Map(anchors[bp].map((item) => [item.panelId, item]));
    if (panels.every((panel) => own.has(panel.id))) return panels.map((p) => own.get(p.id)!);

    const sources = nearestAuthoredBreakpoint(
      bp,
      breakpointOrder.filter((other) => anchors[other].length > 0),
    );
    const derived: DashboardLayoutItem[] = [];
    const undefaulted: Panel[] = [];
    for (const panel of panels) {
      if (own.has(panel.id)) continue;
      const from = sources.find((other) => anchors[other].some((i) => i.panelId === panel.id));
      const item = from && anchors[from].find((i) => i.panelId === panel.id);
      if (from && item) derived.push(scaleLayoutItem(item, dashboardGridCols[from], cols));
      else undefaulted.push(panel);
    }
    // Source reading order (y, then x); a stable sort keeps panel order for ties.
    derived.sort((a, b) => a.y - b.y || a.x - b.x);
    const placed =
      own.size === 0 ? compactLayout(derived, cols) : placeAround(anchors[bp], derived, cols);
    const fixed = [...anchors[bp], ...placed];
    const defaults = createBaseLayoutAround(undefaulted, fixed, cols);
    const byId = new Map([...fixed, ...defaults].map((item) => [item.panelId, item]));
    return panels.map((panel) => byId.get(panel.id)!);
  };

  return {
    lg: resolveFor("lg"),
    md: resolveFor("md"),
    sm: resolveFor("sm"),
    xs: resolveFor("xs"),
  };
}

/** Default-size items for panels no breakpoint holds, in the first free cell of the grid. */
function createBaseLayoutAround(
  missing: Panel[],
  fixed: DashboardLayoutItem[],
  cols: number,
): DashboardLayoutItem[] {
  const itemWidth = defaultItemWidth(cols);
  const placed = [...fixed];
  const out: DashboardLayoutItem[] = [];
  for (const panel of missing) {
    const { x, y } = findNextAvailablePosition(placed, cols, itemWidth, defaultItemHeight);
    const item = { panelId: panel.id, x, y, w: itemWidth, h: defaultItemHeight };
    placed.push(item);
    out.push(item);
  }
  return out;
}

export function areDashboardLayoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  return dashboardLayoutBreakpoints.every((breakpoint) =>
    areBreakpointLayoutsEqual(a[breakpoint], b[breakpoint]),
  );
}

function areBreakpointLayoutsEqual(a: DashboardLayoutItem[], b: DashboardLayoutItem[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  return a.every((item, index) => {
    const other = b[index];
    return (
      item.panelId === other.panelId &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    );
  });
}
