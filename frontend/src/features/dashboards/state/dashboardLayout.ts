import type { ResponsiveGridLayoutProps } from "react-grid-layout";

import type { DashboardLayout, DashboardLayoutItem, Panel } from "../../../types/models";

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

function rectsOverlap(a: DashboardLayoutItem, b: DashboardLayoutItem): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function hasAnyOverlap(items: DashboardLayoutItem[]): boolean {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (rectsOverlap(items[i], items[j])) return true;
    }
  }
  return false;
}

/** Final pass: shift any overlapping items down until they're collision-free.
 * Items are processed in their incoming order, so earlier items (typically saved
 * positions) anchor; later items are bumped down. Defensive against corrupted
 * saved state and against projection-produced collisions when scaling between
 * column counts. Short-circuits when the input already has no overlaps so the
 * common (clean) case stays O(N²) check and avoids any allocation. */
function cleanupOverlaps(items: DashboardLayoutItem[]): DashboardLayoutItem[] {
  if (!hasAnyOverlap(items)) return items;
  const out: DashboardLayoutItem[] = [];
  for (const item of items) {
    let { x, y, w, h } = item;
    let bumped = true;
    while (bumped) {
      bumped = false;
      for (const placed of out) {
        if (rectsOverlap({ panelId: item.panelId, x, y, w, h }, placed)) {
          y = placed.y + placed.h;
          bumped = true;
          break;
        }
      }
    }
    out.push({ panelId: item.panelId, x, y, w, h });
  }
  return out;
}

/** Projects a saved layout from one breakpoint to another by proportionally scaling
 * each item's x and w against the column count. Heights are preserved (column-based
 * grid; rows are unitless). If a panel has no entry in the source layout, it's omitted
 * and resolveBreakpointLayout fills it via the normal non-overlapping placement path.
 */
function projectLayout(
  sourceItems: DashboardLayoutItem[],
  sourceCols: number,
  targetCols: number,
): DashboardLayoutItem[] {
  const scale = targetCols / sourceCols;
  return sourceItems.map((item) => {
    const w = Math.max(1, Math.min(targetCols, Math.round(item.w * scale)));
    const x = Math.max(0, Math.min(targetCols - w, Math.round(item.x * scale)));
    return { panelId: item.panelId, x, y: item.y, w, h: item.h };
  });
}

/** Pick the breakpoint with the most saved entries (preferring larger breakpoints on ties),
 * so we project from the user's primary layout when other breakpoints are empty. */
function pickProjectionSource(
  savedLayout: DashboardLayout,
): { breakpoint: DashboardLayoutBreakpoint; items: DashboardLayoutItem[] } | null {
  let best: { breakpoint: DashboardLayoutBreakpoint; items: DashboardLayoutItem[] } | null = null;
  for (const bp of dashboardLayoutBreakpoints) {
    const items = savedLayout[bp];
    if (items.length === 0) continue;
    if (best === null || items.length > best.items.length) {
      best = { breakpoint: bp, items };
    }
  }
  return best;
}

export function resolveDashboardLayout(
  panels: Panel[],
  savedLayout: DashboardLayout,
): DashboardLayout {
  const projectionSource = pickProjectionSource(savedLayout);

  // For each breakpoint, if the saved layout is empty (or smaller than the panel set),
  // augment it with projections from the chosen source breakpoint so panels keep their
  // relative positions across breakpoint changes instead of replacing to top-left.
  function effectiveSaved(bp: DashboardLayoutBreakpoint): DashboardLayoutItem[] {
    const saved = savedLayout[bp];
    if (saved.length >= panels.length) return saved;
    if (projectionSource === null || projectionSource.breakpoint === bp) return saved;

    const haveIds = new Set(saved.map((item) => item.panelId));
    const projected = projectLayout(
      projectionSource.items.filter((item) => !haveIds.has(item.panelId)),
      dashboardGridCols[projectionSource.breakpoint],
      dashboardGridCols[bp],
    );
    return [...saved, ...projected];
  }

  return {
    lg: cleanupOverlaps(
      resolveBreakpointLayout(panels, effectiveSaved("lg"), dashboardGridCols.lg),
    ),
    md: cleanupOverlaps(
      resolveBreakpointLayout(panels, effectiveSaved("md"), dashboardGridCols.md),
    ),
    sm: cleanupOverlaps(
      resolveBreakpointLayout(panels, effectiveSaved("sm"), dashboardGridCols.sm),
    ),
    xs: cleanupOverlaps(
      resolveBreakpointLayout(panels, effectiveSaved("xs"), dashboardGridCols.xs),
    ),
  };
}

function resolveBreakpointLayout(
  panels: Panel[],
  savedItems: DashboardLayoutItem[],
  colCount: number,
): DashboardLayoutItem[] {
  const savedByPanelId = new Map(
    savedItems
      .filter((item) => item.panelId.trim().length > 0)
      .map((item) => [item.panelId, sanitizeLayoutItem(item)]),
  );

  // Happy path: every panel has a saved entry — skip the placement loop and return
  // the saved positions directly in panel order. This is the case for every render
  // after the first save, which is most renders.
  if (savedByPanelId.size === panels.length) {
    return panels.map((p) => savedByPanelId.get(p.id)!);
  }

  // Collect resolved positions of panels that have saved layout entries first, so we can
  // place any missing-from-saved panels into a non-overlapping slot.
  const resolved: DashboardLayoutItem[] = [];
  const placed: DashboardLayoutItem[] = [];
  const itemWidth = defaultItemWidth(colCount);
  const itemHeight = defaultItemHeight;

  for (const panel of panels) {
    const saved = savedByPanelId.get(panel.id);
    if (saved) {
      resolved.push(saved);
      placed.push(saved);
    } else {
      // No saved entry — likely a newly-created panel, or a panel visiting a breakpoint
      // for the first time. Compute a position that does not overlap with the actual
      // saved positions of the other panels.
      const { x, y } = findNextAvailablePosition(placed, colCount, itemWidth, itemHeight);
      const item: DashboardLayoutItem = { panelId: panel.id, x, y, w: itemWidth, h: itemHeight };
      resolved.push(item);
      placed.push(item);
    }
  }

  return resolved;
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
