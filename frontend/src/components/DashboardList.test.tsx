import { fireEvent, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";

import { createDashboard as createDashboardRequest } from "../services/dashboardService";
import { renderWithStore } from "../test/renderWithStore";
import { DashboardList } from "./DashboardList";

jest.mock("../services/dashboardService", () => ({
  createDashboard: jest.fn(),
  fetchDashboards: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const createDashboardMock = jest.mocked(createDashboardRequest);

describe("DashboardList", () => {
  beforeEach(() => {
    createDashboardMock.mockReset();
  });

  it("renders the dashboards heading and backend-backed dashboard items from state", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations", meta: defaultMeta }],
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Operations" })).toBeInTheDocument();
  });

  it("renders a loading fallback while dashboards are loading", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [],
        status: "loading",
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByText("Loading dashboards...")).toBeInTheDocument();
  });

  it("updates the selected dashboard when a dashboard is clicked", () => {
    const { store } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [
          { id: "dashboard-1", name: "Operations", meta: defaultMeta },
          { id: "dashboard-2", name: "Executive", meta: defaultMeta },
        ],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Executive" }));

    expect(store.getState().dashboards.selectedDashboardId).toBe("dashboard-2");
    expect(screen.getByRole("button", { name: "Executive" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("creates a dashboard inline and selects it", async () => {
    createDashboardMock.mockResolvedValue({
      id: "dashboard-2",
      name: "Executive",
      meta: defaultMeta,
      appearance: {
        background: "transparent",
        gridBackground: "transparent",
      },
      layout: {
        lg: [],
        md: [],
        sm: [],
        xs: [],
      },
    });

    const { store } = renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations", meta: defaultMeta }],
        selectedDashboardId: "dashboard-1",
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add dashboard" }));
    fireEvent.change(screen.getByLabelText("Dashboard name"), {
      target: { value: "Executive" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard" }));

    await waitFor(() => expect(createDashboardMock).toHaveBeenCalledWith("Executive"));
    await waitFor(() =>
      expect(store.getState().dashboards.selectedDashboardId).toBe("dashboard-2"),
    );
    expect(screen.getByRole("button", { name: "Executive" })).toBeInTheDocument();
  });
});
