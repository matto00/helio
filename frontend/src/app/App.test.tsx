import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";

import { dashboardsReducer } from "../features/dashboards/dashboardsSlice";
import { panelsReducer } from "../features/panels/panelsSlice";
import { App } from "./App";

import { fetchDashboards as fetchDashboardsRequest } from "../services/dashboardService";
import { fetchPanels as fetchPanelsRequest } from "../services/panelService";

jest.mock("../services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
}));

jest.mock("../services/panelService", () => ({
  fetchPanels: jest.fn(),
}));

const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);
const fetchPanelsMock = jest.mocked(fetchPanelsRequest);

function renderApp() {
  const store = configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      panels: panelsReducer,
    },
  });

  return {
    store,
    ...render(
      <Provider store={store}>
        <App />
      </Provider>,
    ),
  };
}

describe("App", () => {
  beforeEach(() => {
    fetchDashboardsMock.mockReset();
    fetchPanelsMock.mockReset();
  });

  it("auto-selects the most recently updated dashboard and loads its panels", async () => {
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
      },
      {
        id: "dashboard-2",
        name: "Executive",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T11:00:00Z",
          lastUpdated: "2026-03-14T12:00:00Z",
        },
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchDashboardsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-2"));
    expect(screen.getByRole("button", { name: "Executive" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("loads panels lazily when the user changes the selected dashboard", async () => {
    fetchDashboardsMock.mockResolvedValue([
      {
        id: "dashboard-1",
        name: "Operations",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T10:00:00Z",
          lastUpdated: "2026-03-14T10:00:00Z",
        },
      },
      {
        id: "dashboard-2",
        name: "Executive",
        meta: {
          createdBy: "system",
          createdAt: "2026-03-14T11:00:00Z",
          lastUpdated: "2026-03-14T12:00:00Z",
        },
      },
    ]);
    fetchPanelsMock.mockResolvedValue([]);

    renderApp();

    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-2"));

    fireEvent.click(screen.getByRole("button", { name: "Operations" }));

    await waitFor(() => expect(fetchPanelsMock).toHaveBeenCalledWith("dashboard-1"));
    expect(screen.getByRole("button", { name: "Operations" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
