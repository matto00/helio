import { act } from "@testing-library/react";

import { setEditingLayoutDashboardId } from "../../../layout/state/layoutHistorySlice";

import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { DesktopPanelGrid } from "./DesktopPanelGrid";

jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(() => Promise.reject(new Error("stub"))),
  getAssertionStatus: jest.fn(() => Promise.reject(new Error("stub"))),
}));
jest.mock("../../hooks/usePanelData", () => ({
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
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  updatePanelsBatch: jest.fn(),
}));
jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const panels = [makeOutputPanel({ id: "a", dashboardId: "d1" })];
const layout = {
  lg: [{ panelId: "a", x: 0, y: 0, w: 4, h: 5 }],
  md: [{ panelId: "a", x: 0, y: 0, w: 4, h: 5 }],
  sm: [{ panelId: "a", x: 0, y: 0, w: 4, h: 5 }],
  xs: [],
};

function renderGrid(editing: boolean) {
  const ctx = renderWithStore(
    <DesktopPanelGrid
      dashboardId="d1"
      layout={layout}
      panels={panels}
      zoomLevel={1}
      width={900}
      registerLayoutFlush={jest.fn()}
    />,
    {
      dashboards: { items: [{ id: "d1", name: "D", layout }] },
      panels: { items: panels, status: "succeeded", loadedDashboardId: "d1" },
    },
  );
  if (editing) act(() => void ctx.store.dispatch(setEditingLayoutDashboardId("d1")));
  const item = ctx.container.querySelector<HTMLElement>(".react-grid-item");
  return { ...ctx, item };
}

// React Grid Layout marks a draggable item with `react-draggable` and hides the resize handle of a
// non-resizable one with `react-resizable-hide` (its stylesheet makes that `display: none`). These classes
// are what the library derives from `dragConfig.enabled` / `resizeConfig.enabled`, so they prove the gate
// reaches the real library (a mocked `Responsive` passes with or without it).
describe("DesktopPanelGrid edit mode with the REAL react-grid-layout (HEL-1576 D4)", () => {
  it("view mode: panels are neither draggable nor resizable and the grid is not in edit mode", () => {
    const { container, item } = renderGrid(false);
    expect(container.querySelector(".panel-grid")).not.toHaveClass("panel-grid--editing");
    expect(item).not.toHaveClass("react-draggable");
    expect(item).toHaveClass("react-resizable-hide");
  });

  it("edit mode: panels are draggable and resizable", () => {
    const { container, item } = renderGrid(true);
    expect(container.querySelector(".panel-grid")).toHaveClass("panel-grid--editing");
    expect(item).toHaveClass("react-draggable");
    expect(item).not.toHaveClass("react-resizable-hide");
  });

  it("turning edit mode off again removes both", () => {
    const { store, item } = renderGrid(true);
    act(() => void store.dispatch(setEditingLayoutDashboardId(null)));
    expect(item).not.toHaveClass("react-draggable");
    expect(item).toHaveClass("react-resizable-hide");
  });

  it("only the selected dashboard is in edit mode", () => {
    const { container, store } = renderWithStore(
      <DesktopPanelGrid
        dashboardId="d1"
        layout={layout}
        panels={panels}
        zoomLevel={1}
        width={900}
        registerLayoutFlush={jest.fn()}
      />,
      {
        dashboards: { items: [{ id: "d1", name: "D", layout }] },
        panels: { items: panels, status: "succeeded", loadedDashboardId: "d1" },
      },
    );
    act(() => void store.dispatch(setEditingLayoutDashboardId("d2")));
    expect(container.querySelector(".panel-grid")).not.toHaveClass("panel-grid--editing");
  });

  it("reports itself mounted for its dashboard, and leaving it ends edit mode", () => {
    const { store, unmount } = renderGrid(true);
    expect(store.getState().layoutHistory.desktopGridDashboardId).toBe("d1");
    expect(store.getState().layoutHistory.editingLayoutDashboardId).toBe("d1");
    unmount();
    expect(store.getState().layoutHistory.desktopGridDashboardId).toBeNull();
    expect(store.getState().layoutHistory.editingLayoutDashboardId).toBeNull();
  });

  it("marks a minimum-height (4-row) card short so it takes the tighter vertical rhythm (HEL-1576)", () => {
    const { container } = renderWithStore(
      <DesktopPanelGrid
        dashboardId="d1"
        layout={{
          lg: [],
          md: [],
          sm: [{ panelId: "a", x: 0, y: 0, w: 4, h: 4 }],
          xs: [],
        }}
        panels={panels}
        zoomLevel={1}
        width={900}
        registerLayoutFlush={jest.fn()}
      />,
      {
        dashboards: { items: [{ id: "d1", name: "D", layout }] },
        panels: { items: panels, status: "succeeded", loadedDashboardId: "d1" },
      },
    );
    expect(container.querySelector(".react-grid-item")).toHaveAttribute("data-short-card");
  });

  it("does not mark a taller card short", () => {
    const { item } = renderGrid(false);
    expect(item).not.toHaveAttribute("data-short-card");
  });
});
