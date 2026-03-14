import { screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { DashboardList } from "./DashboardList";

describe("DashboardList", () => {
  it("renders the dashboards heading and backend-backed dashboard items from state", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations" }],
        status: "succeeded",
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
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
});
