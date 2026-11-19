import { act } from "@testing-library/react";

import { DashboardAccessProvider } from "../../../dashboards/state/dashboardAccessContext";
import type { DashboardAccessRole } from "../../../dashboards/types/dashboard";
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

function renderGrid(role: DashboardAccessRole) {
  const ctx = renderWithStore(
    <DashboardAccessProvider role={role}>
      <DesktopPanelGrid
        dashboardId="d1"
        layout={layout}
        panels={panels}
        zoomLevel={1}
        width={900}
        registerLayoutFlush={jest.fn()}
      />
    </DashboardAccessProvider>,
    {
      dashboards: { items: [{ id: "d1", name: "D", layout }] },
      panels: { items: panels, status: "succeeded", loadedDashboardId: "d1" },
    },
  );
  // The store says "editing layout" whatever the role: a viewer's grid must not move regardless.
  act(() => void ctx.store.dispatch(setEditingLayoutDashboardId("d1")));
  return { ...ctx, item: ctx.container.querySelector<HTMLElement>(".react-grid-item") };
}

// HEL-1773 D5: only owners and editors move panels (a viewer's grid never edits, whatever the store says).
describe("DesktopPanelGrid edit mode by role (HEL-1773)", () => {
  it.each(["owner", "editor"] as const)(
    "a %s grid is draggable and resizable in edit mode",
    (role) => {
      const { container, item } = renderGrid(role);
      expect(container.querySelector(".panel-grid")).toHaveClass("panel-grid--editing");
      expect(item).toHaveClass("react-draggable");
    },
  );

  it("a viewer grid is neither draggable nor resizable even when the store is in edit mode", () => {
    const { container, item } = renderGrid("viewer");
    expect(container.querySelector(".panel-grid")).not.toHaveClass("panel-grid--editing");
    expect(item).not.toHaveClass("react-draggable");
    expect(item).toHaveClass("react-resizable-hide");
  });
});
