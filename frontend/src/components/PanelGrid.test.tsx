import { act, fireEvent, screen } from "@testing-library/react";

import { updatePanelTitle as updatePanelTitleRequest } from "../services/panelService";
import { updatePanelsBatch as updatePanelsBatchRequest } from "../services/panelService";
import { renderWithStore } from "../test/renderWithStore";
import { PanelGrid } from "./PanelGrid";

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
};

const emptyLayout = { lg: [], md: [], sm: [], xs: [] };

describe("PanelGrid", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    updatePanelTitleMock.mockReset();
    updatePanelsBatchMock.mockReset();
    updatePanelsBatchMock.mockResolvedValue({ panels: [] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

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
