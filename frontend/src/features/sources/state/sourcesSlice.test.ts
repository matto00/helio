import {
  createStaticSource,
  deleteSource,
  fetchSources,
  sourcesReducer,
  updateSource,
} from "./sourcesSlice";
import type { DataSource } from "../../../types/models";
import * as dataSourceService from "../services/dataSourceService";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn(),
  deleteSource: jest.fn(),
  createStaticSource: jest.fn(),
  updateSource: jest.fn(),
}));

const createStaticSourceMock = jest.mocked(dataSourceService.createStaticSource);

const testSource: DataSource = {
  id: "s-1",
  name: "Sales API",
  type: "rest_api",
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
  config: { url: "https://example.com/api" },
};

describe("sourcesSlice", () => {
  it("populates items when fetchSources fulfills", () => {
    const nextState = sourcesReducer(undefined, fetchSources.fulfilled([testSource], "req-1"));
    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0].name).toBe("Sales API");
    expect(nextState.status).toBe("succeeded");
    expect(nextState.error).toBeNull();
  });

  it("sets loading status on pending", () => {
    const nextState = sourcesReducer(undefined, fetchSources.pending("req-1"));
    expect(nextState.status).toBe("loading");
  });

  it("sets error when fetchSources rejects", () => {
    const nextState = sourcesReducer(
      undefined,
      fetchSources.rejected(null, "req-1", undefined, "Failed to load sources."),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load sources.");
  });

  it("removes item when deleteSource fulfills", () => {
    const initialState = {
      items: [testSource],
      status: "succeeded" as const,
      error: null,
      selectedSourceId: null,
      addModalOpen: false,
    };
    const nextState = sourcesReducer(initialState, deleteSource.fulfilled("s-1", "req-1", "s-1"));
    expect(nextState.items).toHaveLength(0);
  });

  it("appends item when createStaticSource fulfills", () => {
    const staticSource: DataSource = {
      id: "s-2",
      name: "Lookup",
      type: "static",
      createdAt: "2026-04-18T00:00:00Z",
      updatedAt: "2026-04-18T00:00:00Z",
    };
    const nextState = sourcesReducer(
      undefined,
      createStaticSource.fulfilled(staticSource, "req-2", {
        name: "Lookup",
        columns: [{ name: "id", type: "integer" }],
        rows: [[1]],
      }),
    );
    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0].type).toBe("static");
  });
});

describe("createStaticSource thunk", () => {
  beforeEach(() => {
    createStaticSourceMock.mockReset();
  });

  it("dispatches fulfilled with the created source on success", async () => {
    const staticSource: DataSource = {
      id: "s-3",
      name: "My Table",
      type: "static",
      createdAt: "2026-04-18T00:00:00Z",
      updatedAt: "2026-04-18T00:00:00Z",
    };
    createStaticSourceMock.mockResolvedValueOnce(staticSource);

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = createStaticSource({
      name: "My Table",
      columns: [{ name: "x", type: "string" }],
      rows: [["hello"]],
    });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls;
    const fulfilledCall = calls.find(
      ([action]) => action.type === "sources/createStaticSource/fulfilled",
    );
    expect(fulfilledCall).toBeDefined();
    expect(fulfilledCall?.[0].payload).toEqual(staticSource);
  });

  it("dispatches rejected on service error", async () => {
    createStaticSourceMock.mockRejectedValueOnce(new Error("network error"));

    const dispatch = jest.fn();
    const getState = jest.fn();
    const thunk = createStaticSource({
      name: "Broken",
      columns: [],
      rows: [],
    });

    await thunk(dispatch, getState, undefined);

    const calls = dispatch.mock.calls;
    const rejectedCall = calls.find(
      ([action]) => action.type === "sources/createStaticSource/rejected",
    );
    expect(rejectedCall).toBeDefined();
  });
});

describe("updateSource", () => {
  it("updates the matching item name when fulfilled", () => {
    const initialState = {
      items: [testSource],
      status: "succeeded" as const,
      error: null,
      selectedSourceId: null,
      addModalOpen: false,
    };
    const updatedSource = { ...testSource, name: "Renamed API" };
    const nextState = sourcesReducer(
      initialState,
      updateSource.fulfilled(updatedSource, "req-u1", { id: "s-1", name: "Renamed API" }),
    );
    expect(nextState.items[0].name).toBe("Renamed API");
  });

  it("does not modify other items when updating a different source", () => {
    const otherSource = { ...testSource, id: "s-2", name: "Other" };
    const initialState = {
      items: [testSource, otherSource],
      status: "succeeded" as const,
      error: null,
      selectedSourceId: null,
      addModalOpen: false,
    };
    const updatedSource = { ...testSource, name: "Renamed Sales" };
    const nextState = sourcesReducer(
      initialState,
      updateSource.fulfilled(updatedSource, "req-u2", { id: "s-1", name: "Renamed Sales" }),
    );
    expect(nextState.items[0].name).toBe("Renamed Sales");
    expect(nextState.items[1].name).toBe("Other");
  });
});
