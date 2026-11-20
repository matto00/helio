// HEL-1782 D6: while the user owns no dashboard the sidebar list ends in a "Build your own dashboard" row; choosing it
// closes the open dashboard. Once they own one, the row is gone.
import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DashboardList } from "./DashboardList";

jest.mock("../services/dashboardFolderService", () => ({
  fetchDashboardFolders: jest.fn().mockResolvedValue({ folders: [], assignments: [] }),
  createDashboardFolder: jest.fn(),
  updateDashboardFolder: jest.fn(),
  deleteDashboardFolder: jest.fn(),
  moveDashboardToFolder: jest.fn(),
}));
jest.mock("../services/dashboardService");

function setup(items: Array<{ id: string; name: string; accessRole: "owner" | "viewer" }>) {
  return renderWithStore(<DashboardList />, {
    auth: { status: "authenticated", currentUser: { id: "me" } as never },
    dashboards: {
      items: items.map((i) => ({ ...i, ownerId: i.accessRole === "owner" ? "me" : "other" })),
      selectedDashboardId: items[0].id,
      status: "succeeded",
    },
  });
}

describe("DashboardList build-your-own row (HEL-1782)", () => {
  it("is offered to a shared-only user and closes the open dashboard", () => {
    const { store } = setup([{ id: "vw", name: "Theirs", accessRole: "viewer" }]);
    fireEvent.click(screen.getByRole("button", { name: "Build your own dashboard" }));
    expect(store.getState().dashboards.selectedDashboardId).toBeNull();
  });

  it("is absent once the user owns a dashboard", () => {
    setup([
      { id: "vw", name: "Theirs", accessRole: "viewer" },
      { id: "own", name: "Mine", accessRole: "owner" },
    ]);
    expect(screen.queryByRole("button", { name: "Build your own dashboard" })).toBeNull();
  });

  it("is absent for a user with no dashboard at all, who has the New dashboard CTA instead", () => {
    renderWithStore(<DashboardList />, {
      auth: { status: "authenticated", currentUser: { id: "me" } as never },
      dashboards: { items: [], selectedDashboardId: null, status: "succeeded" },
    });
    expect(screen.queryByRole("button", { name: "Build your own dashboard" })).toBeNull();
  });

  // The label takes the list rows' own name treatment (one line, ellipsis), so it cannot wrap out of the fixed-height row.
  it("renders its label in the .dashboard-list__name element the other rows use", () => {
    setup([{ id: "vw", name: "Theirs", accessRole: "viewer" }]);
    const row = screen.getByRole("button", { name: "Build your own dashboard" });
    expect(row.querySelector(".dashboard-list__name")?.textContent).toBe(
      "Build your own dashboard",
    );
  });
});
