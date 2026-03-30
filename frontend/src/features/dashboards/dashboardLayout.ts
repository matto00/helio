import type { ResponsiveGridLayoutProps } from "react-grid-layout";

import type { DashboardLayout, DashboardLayoutItem, Panel } from "../../types/models";

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

function createBaseLayout(panels: Panel[], colCount: number): DashboardLayoutItem[] {
  const itemWidth = colCount >= 10 ? 4 : colCount >= 6 ? 3 : 2;
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

export function resolveDashboardLayout(
  panels: Panel[],
  savedLayout: DashboardLayout,
): DashboardLayout {
  const fallbackLayout = createFallbackDashboardLayout(panels);

  return {
    lg: resolveBreakpointLayout(panels, savedLayout.lg, fallbackLayout.lg),
    md: resolveBreakpointLayout(panels, savedLayout.md, fallbackLayout.md),
    sm: resolveBreakpointLayout(panels, savedLayout.sm, fallbackLayout.sm),
    xs: resolveBreakpointLayout(panels, savedLayout.xs, fallbackLayout.xs),
  };
}

function resolveBreakpointLayout(
  panels: Panel[],
  savedItems: DashboardLayoutItem[],
  fallbackItems: DashboardLayoutItem[],
): DashboardLayoutItem[] {
  const savedByPanelId = new Map(
    savedItems
      .filter((item) => item.panelId.trim().length > 0)
      .map((item) => [item.panelId, sanitizeLayoutItem(item)]),
  );
  const fallbackByPanelId = new Map(fallbackItems.map((item) => [item.panelId, item]));

  return panels.map((panel) => savedByPanelId.get(panel.id) ?? fallbackByPanelId.get(panel.id)!);
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
