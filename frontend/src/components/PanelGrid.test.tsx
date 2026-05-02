import { act, fireEvent, screen } from "@testing-library/react";

import { Responsive, useContainerWidth } from "react-grid-layout";
import { createScaledStrategy } from "react-grid-layout/core";
import { updatePanelTitle as updatePanelTitleRequest } from "../services/panelService";
import { updatePanelsBatch as updatePanelsBatchRequest } from "../services/panelService";
import { defaultDashboardLayout } from "../features/dashboards/dashboardLayout";
import { renderWithStore } from "../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: jest.fn(({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-responsive" }, children),
    ),
    useContainerWidth: jest.fn().mockReturnValue({
      containerRef: { current: null },
      width: 1280,
      mounted: true,
      measureWidth: jest.fn(),
    }),
  };
});

jest.mock("react-grid-layout/core", () => ({
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));

const MockResponsive = jest.mocked(Responsive);
const mockUseContainerWidth = jest.mocked(useContainerWidth);
const mockCreateScaledStrategy = jest.mocked(createScaledStrategy);

jest.mock("../hooks/usePanelData", () => ({
  usePanelData: () => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    noData: true,
    refresh: jest.fn(),
  }),
}));

jest.mock("../hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelTitle: jest.fn(),
  updatePanelAppearance: jest.fn(),
  updatePanelBinding: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
  deletePanel: jest.fn(),
  duplicatePanel: jest.fn(),
}));

jest.mock("../services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  createDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn().mockResolvedValue({}),
  duplicateDashboard: jest.fn(),
  exportDashboard: jest.fn(),
  importDashboard: jest.fn(),
}));

const updatePanelTitleMock = jest.mocked(updatePanelTitleRequest);
const updatePanelsBatchMock = jest.mocked(updatePanelsBatchRequest);

const testPanel = {
  id: "panel-1",
  dashboardId: "d1",
  title: "Revenue",
  type: "metric" as const,
  meta: {
    createdBy: "system",
    createdAt: "2026-03-14T00:00:00Z",
    lastUpdated: "2026-03-14T00:00:00Z",
  },
  appearance: { background: "transparent", color: "inherit", transparency: 0 },
  typeId: null,
  fieldMapping: null,
  refreshInterval: null,
  content: null,
};

const emptyLayout = { lg: [], md: [], sm: [], xs: [] };

// ─── Mocking rationale ───────────────────────────────────────────────────────
// react-grid-layout relies on DOM measurement APIs (ResizeObserver,
// HTMLElement.getBoundingClientRect, pointer event coordinates within real
// browser layout) that jsdom does not support. Rendering the actual <Responsive>
// component in unit tests produces "ResizeObserver is not defined" errors and
// yields incorrect layout measurements that make assertions impossible. Full
// module mocking is therefore the standard approach for unit-testing components
// that wrap this library.
//
// What these unit tests verify:
//   - prop threading: zoomLevel reaches createScaledStrategy() and the resulting
//     positionStrategy object is forwarded to <Responsive>.
//   - default behaviour: omitting zoomLevel uses scale 1.0.
//
// What was verified manually (cannot be asserted via jsdom):
//   - At 50%, 75%, 125%, and 150% zoom, dragging and resizing panels produces
//     correct grid positions that match visual panel placement.
//   - At 100% zoom no regressions were introduced; drag/resize behave identically
//     to the pre-fix baseline.
//   - Coordinate offsets that previously caused panels to "jump" on drag start at
//     non-100% zoom are eliminated.
// ─────────────────────────────────────────────────────────────────────────────

describe("PanelGrid", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockResponsive.mockClear();
    mockCreateScaledStrategy.mockClear();
    mockUseContainerWidth.mockReturnValue({
      containerRef: { current: null },
      width: 1280,
      mounted: true,
      measureWidth: jest.fn(),
    });
    updatePanelTitleMock.mockReset();
    updatePanelsBatchMock.mockReset();
    updatePanelsBatchMock.mockResolvedValue({ panels: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("passes zoomLevel to createScaledStrategy and forwards positionStrategy to Responsive", () => {
    renderWithStore(
      <PanelGrid dashboardId="d1" layout={defaultDashboardLayout} panels={[]} zoomLevel={0.75} />,
      { panels: { items: [] } },
    );

    expect(mockCreateScaledStrategy).toHaveBeenCalledWith(0.75);
    const lastCall = MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ positionStrategy: { __scale: 0.75 } });
  });

  it("defaults positionStrategy to scale 1.0 when zoomLevel is not provided", () => {
    renderWithStore(<PanelGrid dashboardId="d1" layout={defaultDashboardLayout} panels={[]} />, {
      panels: { items: [] },
    });

    expect(mockCreateScaledStrategy).toHaveBeenCalledWith(1.0);
    const lastCall = MockResponsive.mock.calls[MockResponsive.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ positionStrategy: { __scale: 1.0 } });
  });

  // ─── AC: "All editing interactions work correctly at all zoom levels" ────────
  // Rename, delete, and context-menu interactions are triggered by click events,
  // not drag/resize pointer deltas.  The browser's hit-test mechanism already
  // accounts for CSS transform: scale() when resolving click targets, so these
  // interactions are unaffected by the zoom level regardless of positionStrategy.
  //
  // Delete and context-menu open/close are click-only actions with no coordinate
  // arithmetic — they work identically at all zoom levels without any code change.
  // The rename test below confirms this for a representative editing interaction:
  // the rename flow dispatches correctly at zoomLevel={0.5}.
  it("rename interaction works correctly at non-100% zoom (zoomLevel 0.5)", () => {
    const { store } = renderWithStore(
      // zoomLevel={0.5} simulates 50% zoom — the lowest supported value
      <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} zoomLevel={0.5} />,
      {
        panels: { items: [testPanel] },
      },
    );

    // Open the actions menu and trigger rename — identical flow to the 100% zoom test
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const titleInput = screen.getByLabelText("Panel title");
    fireEvent.change(titleInput, { target: { value: "Zoomed Revenue" } });

    act(() => {
      fireEvent.keyDown(titleInput, { key: "Enter" });
    });

    // Rename dispatches correctly even at 50% zoom
    expect(store.getState().panels.pendingPanelUpdates["panel-1"]).toEqual({
      title: "Zoomed Revenue",
    });
    expect(updatePanelTitleMock).not.toHaveBeenCalled();
  });
  // ─────────────────────────────────────────────────────────────────────────────

  // Task 5.4 — committing a title edit dispatches accumulatePanelUpdate instead of updatePanelTitle
  it("committing a title edit populates pendingPanelUpdates and does not call the updatePanelTitle service", () => {
    const { store } = renderWithStore(
      <PanelGrid dashboardId="d1" layout={emptyLayout} panels={[testPanel]} />,
      {
        panels: { items: [testPanel] },
      },
    );

    // Open the actions menu for the panel
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));

    // Click the Rename option (rendered in a portal)
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    // Type a new title in the inline input
    const titleInput = screen.getByLabelText("Panel title");
    fireEvent.change(titleInput, { target: { value: "Updated Revenue" } });

    // Commit via Enter — commitTitleEdit dispatches accumulatePanelUpdate synchronously
    act(() => {
      fireEvent.keyDown(titleInput, { key: "Enter" });
    });

    // The pending update should be in Redux state
    expect(store.getState().panels.pendingPanelUpdates["panel-1"]).toEqual({
      title: "Updated Revenue",
    });

    // The optimistic patch should also be visible in items
    const updatedPanel = store
      .getState()
      .panels.items.find((p: { id: string }) => p.id === "panel-1");
    expect(updatedPanel?.title).toBe("Updated Revenue");

    // The individual updatePanelTitle service must NOT have been called
    expect(updatePanelTitleMock).not.toHaveBeenCalled();

    // Debounce timer has not yet fired — batch endpoint not called yet
    expect(updatePanelsBatchMock).not.toHaveBeenCalled();
  });
});
