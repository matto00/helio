import { createStaticSource, deleteSource, fetchSources, sourcesReducer } from "./sourcesSlice";
import * as dataSourceService from "../../services/dataSourceService";

jest.mock("../../services/dataSourceService", () => ({
  fetchSources: jest.fn(),
  deleteSource: jest.fn(),
  createStaticSource: jest.fn(),
}));

const createStaticSourceMock = jest.mocked(dataSourceService.createStaticSource);

const testSource = {
  id: "s-1",
  name: "Sales API",
  sourceType: "rest_api",
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
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
    };
    const nextState = sourcesReducer(initialState, deleteSource.fulfilled("s-1", "req-1", "s-1"));
    expect(nextState.items).toHaveLength(0);
  });

  it("appends item when createStaticSource fulfills", () => {
    const staticSource = {
      id: "s-2",
      name: "Lookup",
      sourceType: "static",
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
    expect(nextState.items[0].sourceType).toBe("static");
  });
});

describe("createStaticSource thunk", () => {
  beforeEach(() => {
    createStaticSourceMock.mockReset();
  });

  it("dispatches fulfilled with the created source on success", async () => {
    const staticSource = {
      id: "s-3",
      name: "My Table",
      sourceType: "static",
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
