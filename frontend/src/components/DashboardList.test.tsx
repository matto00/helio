import { screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { DashboardList } from "./DashboardList";

describe("DashboardList", () => {
  it("renders the dashboards heading and dashboard items from state", () => {
    renderWithStore(<DashboardList />, {
      dashboards: {
        items: [{ id: "dashboard-1", name: "Operations" }],
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByRole("heading", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });
});
