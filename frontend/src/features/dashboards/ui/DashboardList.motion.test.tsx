import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DashboardList } from "./DashboardList";

// HEL-1573 consumer test: the dashboard list uses the staggered entrance and the layout slide primitives.

jest.mock("../services/dashboardFolderService", () => ({
  fetchDashboardFolders: jest.fn().mockResolvedValue({ folders: [], assignments: [] }),
  createDashboardFolder: jest.fn(),
  updateDashboardFolder: jest.fn(),
  deleteDashboardFolder: jest.fn(),
  moveDashboardToFolder: jest.fn(),
}));

jest.mock("../services/dashboardService", () => ({
  createDashboard: jest.fn(),
  deleteDashboard: jest.fn(),
  duplicateDashboard: jest.fn(),
  fetchDashboards: jest.fn(),
  renameDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const meta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const dashboards = ["Ops", "Sales", "Growth"].map((name) => ({
  id: `id-${name}`,
  name,
  meta,
}));

describe("DashboardList motion primitives (HEL-1573)", () => {
  it("staggers its rows in order and keys each for the layout slide", () => {
    const { container } = renderWithStore(<DashboardList />, {
      dashboards: { items: dashboards, status: "succeeded" },
      panels: { items: [] },
    });
    const rows = [...container.querySelectorAll<HTMLElement>("li.dashboard-list__item")];
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.style.getPropertyValue("--motion-index"))).toEqual([
      "0",
      "1",
      "2",
    ]);
    for (const row of rows) expect(row).toHaveClass("motion-enter");
    expect(rows.map((row) => row.getAttribute("data-motion-key"))).toEqual(
      dashboards.map((d) => d.id),
    );
    expect(screen.getByRole("button", { name: "Ops" })).toBeInTheDocument();
  });
});
