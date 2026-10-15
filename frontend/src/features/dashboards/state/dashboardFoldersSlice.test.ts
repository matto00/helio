import { configureStore } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import * as folderService from "../services/dashboardFolderService";
import {
  createDashboardFolder,
  dashboardFoldersReducer,
  deleteDashboardFolder,
  fetchDashboardFolders,
  moveDashboardToFolder,
  renameDashboardFolder,
  setDashboardFolderCollapsed,
} from "./dashboardFoldersSlice";

jest.mock("../services/dashboardFolderService");
const service = jest.mocked(folderService);

const daily = { id: "f-1", name: "Daily", collapsed: false, createdAt: "2026-01-01T00:00:00Z" };
const work = { id: "f-2", name: "Work", collapsed: false, createdAt: "2026-01-02T00:00:00Z" };

function makeStore() {
  return configureStore({ reducer: { dashboardFolders: dashboardFoldersReducer } });
}

async function loaded() {
  service.fetchDashboardFolders.mockResolvedValue({
    folders: [daily, work],
    assignments: [{ dashboardId: "d-1", folderId: "f-1" }],
  });
  const store = makeStore();
  await store.dispatch(fetchDashboardFolders());
  return store;
}

describe("dashboardFoldersSlice", () => {
  beforeEach(() => jest.resetAllMocks());

  it("loads folders and indexes assignments by dashboard", async () => {
    const store = await loaded();
    expect(store.getState().dashboardFolders.folders).toEqual([daily, work]);
    expect(store.getState().dashboardFolders.assignments).toEqual({ "d-1": "f-1" });
    expect(store.getState().dashboardFolders.status).toBe("succeeded");
  });

  it("does not refetch once loaded, but retries after a failure", async () => {
    const store = await loaded();
    await store.dispatch(fetchDashboardFolders());
    expect(service.fetchDashboardFolders).toHaveBeenCalledTimes(1);

    service.fetchDashboardFolders.mockRejectedValueOnce(new Error("x"));
    const failing = makeStore();
    await failing.dispatch(fetchDashboardFolders());
    expect(failing.getState().dashboardFolders.status).toBe("failed");
    service.fetchDashboardFolders.mockResolvedValueOnce({ folders: [], assignments: [] });
    await failing.dispatch(fetchDashboardFolders());
    expect(failing.getState().dashboardFolders.status).toBe("succeeded");
  });

  it("creates and renames a folder", async () => {
    const store = makeStore();
    service.createDashboardFolder.mockResolvedValue(daily);
    await store.dispatch(createDashboardFolder({ name: "Daily" }));
    expect(store.getState().dashboardFolders.folders).toEqual([daily]);
    service.updateDashboardFolder.mockResolvedValue({ ...daily, name: "Morning" });
    await store.dispatch(renameDashboardFolder({ folderId: "f-1", name: "Morning" }));
    expect(store.getState().dashboardFolders.folders[0]?.name).toBe("Morning");
  });

  it("surfaces the server's message when create is rejected, and stores nothing", async () => {
    const store = makeStore();
    service.createDashboardFolder.mockRejectedValue(
      Object.assign(new Error("x"), {
        isAxiosError: true,
        response: { data: { message: "A folder with that name already exists" } },
      }),
    );
    const result = await store.dispatch(createDashboardFolder({ name: "Daily" }));
    expect(createDashboardFolder.rejected.match(result)).toBe(true);
    expect(store.getState().dashboardFolders.folders).toEqual([]);
  });

  it("collapse is optimistic and rolls back when the save fails", async () => {
    const store = await loaded();
    let rejectSave: (e: Error) => void = () => {};
    service.updateDashboardFolder.mockReturnValue(
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
    );
    const pending = store.dispatch(
      setDashboardFolderCollapsed({ folderId: "f-1", collapsed: true }),
    );
    expect(store.getState().dashboardFolders.folders[0]?.collapsed).toBe(true);
    rejectSave(new Error("offline"));
    await pending;
    expect(store.getState().dashboardFolders.folders[0]?.collapsed).toBe(false);
  });

  it("a move is optimistic, and unfiling removes the assignment", async () => {
    const store = await loaded();
    service.moveDashboardToFolder.mockResolvedValue();
    await store.dispatch(moveDashboardToFolder({ dashboardId: "d-1", folderId: "f-2" }));
    expect(store.getState().dashboardFolders.assignments).toEqual({ "d-1": "f-2" });
    await store.dispatch(moveDashboardToFolder({ dashboardId: "d-1", folderId: null }));
    expect(store.getState().dashboardFolders.assignments).toEqual({});
  });

  it("a failed move restores the previous filing", async () => {
    const store = await loaded();
    service.moveDashboardToFolder.mockRejectedValue(new Error("nope"));
    await store.dispatch(moveDashboardToFolder({ dashboardId: "d-1", folderId: "f-2" }));
    expect(store.getState().dashboardFolders.assignments).toEqual({ "d-1": "f-1" });
  });

  it("deleting a folder drops its filings", async () => {
    const store = await loaded();
    service.deleteDashboardFolder.mockResolvedValue();
    await store.dispatch(deleteDashboardFolder({ folderId: "f-1" }));
    expect(store.getState().dashboardFolders.folders).toEqual([work]);
    expect(store.getState().dashboardFolders.assignments).toEqual({});
  });

  it("is wiped on sign-out so the next user never sees these folders", async () => {
    const store = await loaded();
    store.dispatch(clearAuth());
    expect(store.getState().dashboardFolders).toMatchObject({
      folders: [],
      assignments: {},
      status: "idle",
    });
  });
});
