import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import * as folderService from "../services/dashboardFolderService";
import { DashboardList } from "./DashboardList";

jest.mock("../services/dashboardFolderService");
jest.mock("../services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  createDashboard: jest.fn(),
  deleteDashboard: jest.fn(),
  duplicateDashboard: jest.fn(),
  exportDashboard: jest.fn(),
  importDashboard: jest.fn(),
  renameDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn(),
  repairDashboardLayout: jest.fn(),
}));

const service = jest.mocked(folderService);
const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};
const dashboards = ["Markets", "News", "Sports", "Helio"].map((name, i) => ({
  id: `d-${i}`,
  name,
  meta,
}));
const daily = { id: "f-1", name: "Daily", collapsed: false, createdAt: "2026-01-01T00:00:00Z" };
const work = { id: "f-2", name: "Work", collapsed: false, createdAt: "2026-01-02T00:00:00Z" };

function renderList(
  list: { folders: (typeof daily)[]; assignments: { dashboardId: string; folderId: string }[] },
  selectedDashboardId: string | null = null,
) {
  service.fetchDashboardFolders.mockResolvedValue(list);
  return renderWithStore(<DashboardList />, {
    dashboards: { items: dashboards, status: "succeeded", selectedDashboardId },
  });
}

describe("DashboardList folders", () => {
  beforeEach(() => jest.resetAllMocks());

  it("groups dashboards under their folder with a count, and the rest under Unfiled", async () => {
    renderList({
      folders: [daily, work],
      assignments: [
        { dashboardId: "d-0", folderId: "f-1" },
        { dashboardId: "d-1", folderId: "f-1" },
        { dashboardId: "d-3", folderId: "f-2" },
      ],
    });
    const dailyGroup = await screen.findByRole("region", { name: "Folder Daily" });
    expect(within(dailyGroup).getByText("2")).toBeInTheDocument();
    expect(within(dailyGroup).getByRole("button", { name: "Markets" })).toBeInTheDocument();
    const workGroup = screen.getByRole("region", { name: "Folder Work" });
    expect(within(workGroup).getByText("1")).toBeInTheDocument();
    const unfiled = screen.getByRole("region", { name: "Unfiled" });
    expect(within(unfiled).getByRole("button", { name: "Sports" })).toBeInTheDocument();
    expect(within(unfiled).queryByRole("button", { name: "Markets" })).not.toBeInTheDocument();
  });

  it("shows no Unfiled heading and a flat list when there are no folders", async () => {
    renderList({ folders: [], assignments: [] });
    expect(await screen.findByRole("button", { name: "Markets" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Unfiled" })).not.toBeInTheDocument();
  });

  it("counts only filings of dashboards in the loaded list (a revoked grant never counts)", async () => {
    renderList({
      folders: [daily],
      assignments: [
        { dashboardId: "d-0", folderId: "f-1" },
        { dashboardId: "gone", folderId: "f-1" },
      ],
    });
    const group = await screen.findByRole("region", { name: "Folder Daily" });
    expect(within(group).getByText("1")).toBeInTheDocument();
  });

  it("collapses a folder through the API and hides its dashboards, keeping the count", async () => {
    service.updateDashboardFolder.mockResolvedValue({ ...daily, collapsed: true });
    renderList({ folders: [daily], assignments: [{ dashboardId: "d-0", folderId: "f-1" }] });
    const toggle = await screen.findByRole("button", { name: "Daily 1" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(service.updateDashboardFolder).toHaveBeenCalledWith("f-1", { collapsed: true });
    expect(screen.queryByRole("button", { name: "Markets" })).not.toBeInTheDocument();
    expect(within(toggle).getByText("1")).toBeInTheDocument();
  });

  it("collapses the folder that holds the open dashboard, and saves exactly what is shown", async () => {
    service.updateDashboardFolder.mockResolvedValue({ ...daily, collapsed: true });
    renderList({ folders: [daily], assignments: [{ dashboardId: "d-0", folderId: "f-1" }] }, "d-0");
    const toggle = await screen.findByRole("button", { name: "Daily 1" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(service.updateDashboardFolder).toHaveBeenCalledWith("f-1", { collapsed: true });
    expect(screen.queryByRole("button", { name: "Markets" })).not.toBeInTheDocument();
  });

  it("reveals a saved-collapsed folder once on navigating into it, then the toggle flips what is shown", async () => {
    service.updateDashboardFolder.mockResolvedValue({ ...daily, collapsed: true });
    renderList(
      {
        folders: [{ ...daily, collapsed: true }],
        assignments: [{ dashboardId: "d-0", folderId: "f-1" }],
      },
      "d-0",
    );
    const toggle = await screen.findByRole("button", { name: "Daily 1" });
    // Revealed without saving anything.
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Markets" })).toBeInTheDocument();
    expect(service.updateDashboardFolder).not.toHaveBeenCalled();
    // The first click closes what is shown (the old code re-sent collapsed:true and nothing changed).
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("button", { name: "Markets" })).not.toBeInTheDocument();
    expect(service.updateDashboardFolder).toHaveBeenCalledWith("f-1", { collapsed: true });
    // And it can be opened again, saving collapsed:false.
    service.updateDashboardFolder.mockResolvedValue({ ...daily, collapsed: false });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"));
    expect(service.updateDashboardFolder).toHaveBeenLastCalledWith("f-1", { collapsed: false });
  });

  it("does not reveal a collapsed folder the open dashboard is not in", async () => {
    renderList(
      {
        folders: [{ ...daily, collapsed: true }],
        assignments: [{ dashboardId: "d-0", folderId: "f-1" }],
      },
      "d-3",
    );
    const toggle = await screen.findByRole("button", { name: "Daily 1" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("creates a folder from New folder", async () => {
    service.createDashboardFolder.mockResolvedValue(daily);
    renderList({ folders: [], assignments: [] });
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "Daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(await screen.findByRole("region", { name: "Folder Daily" })).toBeInTheDocument();
    expect(service.createDashboardFolder).toHaveBeenCalledWith("Daily");
  });

  it("shows the server's message when a duplicate folder name is refused", async () => {
    service.createDashboardFolder.mockRejectedValue(
      Object.assign(new Error("x"), {
        isAxiosError: true,
        response: { data: { message: "A folder with that name already exists" } },
      }),
    );
    renderList({ folders: [daily], assignments: [] });
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Folder name" }), {
      target: { value: "daily" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));
    expect(await screen.findByText("A folder with that name already exists")).toBeInTheDocument();
  });

  it("renames a folder inline", async () => {
    service.updateDashboardFolder.mockResolvedValue({ ...daily, name: "Morning" });
    renderList({ folders: [daily], assignments: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Daily folder actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename folder" }));
    const input = screen.getByRole("textbox", { name: "Folder name" });
    fireEvent.change(input, { target: { value: "Morning" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("region", { name: "Folder Morning" })).toBeInTheDocument();
    expect(service.updateDashboardFolder).toHaveBeenCalledWith("f-1", { name: "Morning" });
  });

  it("deletes a folder after confirming, keeping its dashboards as Unfiled", async () => {
    service.deleteDashboardFolder.mockResolvedValue();
    renderList({ folders: [daily], assignments: [{ dashboardId: "d-0", folderId: "f-1" }] });
    fireEvent.click(await screen.findByRole("button", { name: "Daily folder actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    expect(screen.getByText("Its dashboards are kept and move to Unfiled.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Folder Daily" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Markets" })).toBeInTheDocument();
  });

  it("moves a dashboard to another folder, and to Unfiled, from the keyboard-operable picker", async () => {
    service.moveDashboardToFolder.mockResolvedValue();
    renderList({ folders: [daily, work], assignments: [{ dashboardId: "d-0", folderId: "f-1" }] });
    await screen.findByRole("region", { name: "Folder Daily" });
    fireEvent.click(screen.getByRole("button", { name: "Markets actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const picker = screen.getByRole("group", { name: "Move to" });
    expect(within(picker).getByRole("button", { name: "Daily" })).toBeDisabled();
    fireEvent.click(within(picker).getByRole("button", { name: "Work" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Folder Work" })).getByRole("button", {
          name: "Markets",
        }),
      ).toBeInTheDocument(),
    );
    expect(service.moveDashboardToFolder).toHaveBeenCalledWith("d-0", "f-2");

    fireEvent.click(screen.getByRole("button", { name: "Markets actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Move to" })).getByRole("button", {
        name: "Unfiled",
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Unfiled" })).getByRole("button", {
          name: "Markets",
        }),
      ).toBeInTheDocument(),
    );
  });

  it("reports a failed move and puts the dashboard back", async () => {
    service.moveDashboardToFolder.mockRejectedValue(new Error("nope"));
    renderList({ folders: [daily, work], assignments: [{ dashboardId: "d-0", folderId: "f-1" }] });
    await screen.findByRole("region", { name: "Folder Daily" });
    fireEvent.click(screen.getByRole("button", { name: "Markets actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    fireEvent.click(
      within(screen.getByRole("group", { name: "Move to" })).getByRole("button", { name: "Work" }),
    );
    expect(await screen.findByText("Failed to move dashboard.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Folder Daily" })).getByRole("button", {
        name: "Markets",
      }),
    ).toBeInTheDocument();
  });

  it("applies the filter across groups and hides folders it empties", async () => {
    renderList({
      folders: [daily, work],
      assignments: [
        { dashboardId: "d-0", folderId: "f-1" },
        { dashboardId: "d-3", folderId: "f-2" },
      ],
    });
    fireEvent.change(await screen.findByRole("textbox", { name: "Filter dashboards by name" }), {
      target: { value: "helio" },
    });
    expect(screen.getByRole("button", { name: "Helio" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Folder Daily" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Markets" })).not.toBeInTheDocument();
  });

  it("offers no Move to… while the user has no folders", async () => {
    renderList({ folders: [], assignments: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Markets actions" }));
    expect(screen.queryByRole("menuitem", { name: "Move to…" })).not.toBeInTheDocument();
  });

  it("falls back to an ungrouped list with an inline error when folders cannot load", async () => {
    service.fetchDashboardFolders.mockRejectedValue(new Error("down"));
    renderWithStore(<DashboardList />, { dashboards: { items: dashboards, status: "succeeded" } });
    expect(await screen.findByRole("button", { name: "Markets" })).toBeInTheDocument();
    expect(await screen.findByText("Failed to load folders.")).toBeInTheDocument();
  });
});
