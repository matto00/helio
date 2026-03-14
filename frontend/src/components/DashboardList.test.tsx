import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { DashboardList } from "./DashboardList";

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

describe("DashboardList", () => {
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
});
