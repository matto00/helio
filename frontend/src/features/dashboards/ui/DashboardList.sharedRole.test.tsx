// HEL-1773 D7/D5: shared dashboards are listed WITH a "Shared" marker, and each row's menu offers only what the caller's role
// permits (editor: rename + export; viewer: no menu; owner: everything).
import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { DashboardList } from "./DashboardList";

jest.mock("../services/dashboardFolderService", () => ({
  fetchDashboardFolders: jest.fn().mockResolvedValue({
    folders: [{ id: "f1", name: "F", collapsed: false, position: 0 }],
    assignments: [],
  }),
  createDashboardFolder: jest.fn(),
  updateDashboardFolder: jest.fn(),
  deleteDashboardFolder: jest.fn(),
  moveDashboardToFolder: jest.fn(),
}));
jest.mock("../services/dashboardService");

function setup() {
  return renderWithStore(<DashboardList />, {
    auth: { status: "authenticated", currentUser: { id: "me" } as never },
    dashboards: {
      items: [
        { id: "own", name: "Mine", accessRole: "owner", ownerId: "me" },
        { id: "ed", name: "Edit me", accessRole: "editor", ownerId: "other" },
        { id: "vw", name: "Look only", accessRole: "viewer", ownerId: "other" },
      ],
      selectedDashboardId: "own",
      status: "succeeded",
    },
  });
}

function menuItems(name: string): string[] {
  fireEvent.click(screen.getByRole("button", { name: `${name} actions` }));
  return screen.getAllByRole("menuitem").map((el) => el.textContent?.trim() ?? "");
}

describe("DashboardList shared dashboards", () => {
  it("marks shared dashboards and not owned ones, in the visible badge and the accessible name", () => {
    setup();
    expect(screen.getByRole("button", { name: "Mine" })).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Mine" })).queryByText("Shared")).toBeNull();
    for (const name of ["Edit me", "Look only"]) {
      const row = screen.getByRole("button", { name: `${name} (Shared)` });
      expect(within(row).getByText("Shared")).toBeInTheDocument();
    }
  });

  // A folder exists, so "Move to…" is on offer to whoever may move the dashboard: the owner, never an editor.
  it("offers an owner every action", async () => {
    setup();
    await screen.findByText("F");
    expect(menuItems("Mine")).toEqual([
      "Rename",
      "Duplicate",
      "Share",
      "Export",
      "Move to…",
      "Delete",
    ]);
  });

  it("offers an editor only rename and export, even with folders present", async () => {
    setup();
    await screen.findByText("F");
    expect(menuItems("Edit me")).toEqual(["Rename", "Export"]);
  });

  it("offers a viewer no menu at all", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Look only actions" })).toBeNull();
  });
});
