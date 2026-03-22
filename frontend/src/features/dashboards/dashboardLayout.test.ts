import {
  areDashboardLayoutsEqual,
  createFallbackDashboardLayout,
  resolveDashboardLayout,
} from "./dashboardLayout";

const panels = [
  {
    id: "panel-1",
    dashboardId: "dashboard-1",
    title: "Revenue Pulse",
    type: "metric" as const,
    meta: {
      createdBy: "system",
      createdAt: "2026-03-14T00:00:00Z",
      lastUpdated: "2026-03-14T00:00:00Z",
    },
    appearance: {
      background: "transparent",
      color: "inherit",
      transparency: 0,
    },
  },
  {
    id: "panel-2",
    dashboardId: "dashboard-1",
    title: "Forecast",
    type: "metric" as const,
    meta: {
      createdBy: "system",
      createdAt: "2026-03-14T00:00:00Z",
      lastUpdated: "2026-03-14T00:00:00Z",
    },
    appearance: {
      background: "transparent",
      color: "inherit",
      transparency: 0,
    },
  },
];

describe("dashboardLayout helpers", () => {
  it("creates responsive fallback layouts for all panels", () => {
    const layout = createFallbackDashboardLayout(panels);

    expect(layout.lg).toHaveLength(2);
    expect(layout.md).toHaveLength(2);
    expect(layout.sm).toHaveLength(2);
    expect(layout.xs).toHaveLength(2);
    expect(layout.lg[0]).toMatchObject({ panelId: "panel-1", x: 0, y: 0, w: 4, h: 5 });
  });

  it("merges saved layout items with fallbacks for missing panels", () => {
    const layout = resolveDashboardLayout(panels, {
      lg: [{ panelId: "panel-2", x: 6, y: 1, w: 5, h: 6 }],
      md: [],
      sm: [],
      xs: [],
    });

    expect(layout.lg[0]).toMatchObject({ panelId: "panel-1" });
    expect(layout.lg[1]).toMatchObject({ panelId: "panel-2", x: 6, y: 1, w: 5, h: 6 });
  });

  it("compares layouts by breakpoint item values", () => {
    const first = createFallbackDashboardLayout(panels);
    const second = createFallbackDashboardLayout(panels);
    const third = {
      ...second,
      lg: [{ ...second.lg[0], x: second.lg[0].x + 1 }, second.lg[1]],
    };

    expect(areDashboardLayoutsEqual(first, second)).toBe(true);
    expect(areDashboardLayoutsEqual(first, third)).toBe(false);
  });
});
