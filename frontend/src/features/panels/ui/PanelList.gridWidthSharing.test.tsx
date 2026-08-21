import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelList } from "./PanelList";

// HEL-528 skeptic-final-1.md CR1 — regression lock for the "PanelGrid arrives
// 51px too wide and animates back" defect. Root cause: `PanelGridSkeleton.tsx`
// and `PanelGrid.tsx` EACH called `react-grid-layout`'s `useContainerWidth()`
// independently, so the instant the skeleton unmounted and `PanelGrid` mounted
// fresh, its own brand-new hook call re-entered `panelGridConfig.initialWidth`
// (1280) against the real, already-settled container width — a live,
// browser-only timing bug (jsdom's static `offsetWidth` stub can't reproduce
// the divergence a real ResizeObserver measurement produces, so the actual
// pixel jump is verified live — see files-modified.md's Cycle-3 section, not
// here). What CAN be locked at the unit level, and is the fix's actual
// mechanism, is the STRUCTURAL guarantee: exactly ONE measurement, owned by
// `PanelList` (the only consumer of both), threaded to both branches as a
// plain `width` prop — never re-measured per branch.
//
// `PanelGrid`/`PanelGridSkeleton` are mocked here (capturing the `width` prop
// each receives) precisely so `useContainerWidth`'s only possible caller in
// this render tree is `PanelList` itself — isolating the assertion below from
// react-grid-layout's real RGL internals. `PanelGrid.test.tsx` and
// `PanelGridSkeleton.test.tsx` cover the other half: neither component's own
// mock provides a `useContainerWidth` export at all, so if either ever
// reintroduces an internal call, those suites fail immediately and loudly.

const capturedSkeletonWidths: number[] = [];
const capturedGridWidths: number[] = [];

jest.mock("./PanelGridSkeleton", () => ({
  PanelGridSkeleton: ({ width }: { width: number }) => {
    capturedSkeletonWidths.push(width);
    return <div data-testid="mock-grid-skeleton" />;
  },
}));

jest.mock("./PanelGrid", () => {
  const React = require("react") as typeof import("react");
  return {
    PanelGrid: React.forwardRef(function MockPanelGrid(
      { width }: { width: number },
      _ref: unknown,
    ) {
      capturedGridWidths.push(width);
      return <div data-testid="mock-panel-grid" />;
    }),
  };
});

jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));

jest.mock("../../dashboards/services/dashboardService", () => ({
  createDashboard: jest.fn(),
}));

jest.mock("../../auth/services/authService", () => ({
  updateUserPreferencesRequest: jest.fn().mockResolvedValue({ accentColor: null, zoomLevels: {} }),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const defaultDashboardAppearance = { background: "transparent", gridBackground: "transparent" };
const defaultDashboardLayout = { lg: [], md: [], sm: [], xs: [] };
const defaultPanelAppearance = { background: "transparent", color: "inherit", transparency: 0 };

const dashboardsState = {
  items: [
    {
      id: "dashboard-1",
      name: "Operations",
      meta: defaultMeta,
      appearance: defaultDashboardAppearance,
      layout: defaultDashboardLayout,
    },
  ],
  selectedDashboardId: "dashboard-1",
};

beforeEach(() => {
  capturedSkeletonWidths.length = 0;
  capturedGridWidths.length = 0;
});

describe("PanelList — grid-width sharing (HEL-528 skeptic-final-1.md CR1)", () => {
  it("passes a defined numeric width to PanelGridSkeleton while panels are loading", () => {
    renderWithStore(<PanelList />, {
      dashboards: dashboardsState,
      panels: { items: [], loadedDashboardId: null, status: "loading" },
    });

    expect(screen.getByTestId("mock-grid-skeleton")).toBeInTheDocument();
    expect(capturedSkeletonWidths.length).toBeGreaterThan(0);
    expect(typeof capturedSkeletonWidths[capturedSkeletonWidths.length - 1]).toBe("number");
    expect(capturedSkeletonWidths[capturedSkeletonWidths.length - 1]).toBeGreaterThan(0);
  });

  it("passes a defined numeric width to PanelGrid once panels resolve, equal to what the skeleton used for the same container", () => {
    const panel = {
      id: "panel-1",
      dashboardId: "dashboard-1",
      title: "Revenue",
      meta: defaultMeta,
      appearance: defaultPanelAppearance,
    };

    // Two independent mounts of the SAME dashboard/container context — one
    // caught mid-load (skeleton), one already resolved (grid). Both must
    // report the identical measured width for that container: a value that
    // silently diverged between them (the CR1 defect's underlying contract
    // violation, independent of the specific jsdom-invisible pixel timing)
    // would fail this assertion.
    renderWithStore(<PanelList />, {
      dashboards: dashboardsState,
      panels: { items: [], loadedDashboardId: null, status: "loading" },
    });
    const skeletonWidth = capturedSkeletonWidths[capturedSkeletonWidths.length - 1];

    renderWithStore(<PanelList />, {
      dashboards: dashboardsState,
      panels: { items: [panel], loadedDashboardId: "dashboard-1", status: "succeeded" },
    });
    const gridWidth = capturedGridWidths[capturedGridWidths.length - 1];

    expect(screen.getAllByTestId("mock-panel-grid")).not.toHaveLength(0);
    expect(gridWidth).toBe(skeletonWidth);
  });
});
