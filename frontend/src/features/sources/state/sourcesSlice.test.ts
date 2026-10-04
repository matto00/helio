import { AxiosError, type AxiosResponse } from "axios";
import { configureStore } from "@reduxjs/toolkit";
import {
  createStaticSource,
  deleteSource,
  fetchSourceReferences,
  fetchSources,
  isSourceDeleteConflict,
  sourcesReducer,
  updateSource,
} from "./sourcesSlice";
import type { DataSource } from "../types/dataSource";
import * as dataSourceService from "../services/dataSourceService";

jest.mock("../services/dataSourceService", () => ({
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
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
  inferredSchema: [],
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
      fetchSources.rejected(null, "req-1", undefined, {
        message: "Failed to load sources.",
        kind: "error",
      }),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load sources.");
    expect(nextState.errorKind).toBe("error");
  });

  it("removes item when deleteSource fulfills", () => {
    const initialState = {
      items: [testSource],
      status: "succeeded" as const,
      error: null,
      errorKind: null,
      selectedSourceId: null,
      addModalOpen: false,
      references: {},
      referencesStatus: "idle" as const,
    };
    const nextState = sourcesReducer(initialState, deleteSource.fulfilled("s-1", "req-1", "s-1"));
    expect(nextState.items).toHaveLength(0);
  });

  it("appends item when createStaticSource fulfills", () => {
    const staticSource: DataSource = {
      id: "s-2",
      name: "Lookup",
      type: "dataset",
      createdAt: "2026-04-18T00:00:00Z",
      updatedAt: "2026-04-18T00:00:00Z",
      inferredSchema: [],
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
    expect(nextState.items[0].type).toBe("dataset");
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
      type: "dataset",
      createdAt: "2026-04-18T00:00:00Z",
      updatedAt: "2026-04-18T00:00:00Z",
      inferredSchema: [],
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
      errorKind: null,
      selectedSourceId: null,
      addModalOpen: false,
      references: {},
      referencesStatus: "idle" as const,
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
      errorKind: null,
      selectedSourceId: null,
      addModalOpen: false,
      references: {},
      referencesStatus: "idle" as const,
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

describe("deleteSource thunk (HEL-989 any-reference 409)", () => {
  const deleteSourceMock = jest.mocked(dataSourceService.deleteSource);

  function axios409(data: unknown): AxiosError {
    const err = new AxiosError("Conflict", "ERR_BAD_REQUEST");
    err.response = { status: 409, data } as AxiosResponse;
    return err;
  }

  function makeStore() {
    return configureStore({ reducer: { sources: sourcesReducer } });
  }

  beforeEach(() => deleteSourceMock.mockReset());

  it("preserves the 409 message, the named pipelines and panels, and the hidden counts as a structured rejection", async () => {
    deleteSourceMock.mockRejectedValue(
      axios409({
        message: "this source is still referenced by pipeline(s) 'Sales' (p-1); remove it first",
        pipelines: [{ id: "p-1", name: "Sales", references: ["root", "join", 3] }, { id: 7 }],
        panels: [
          { id: "pn-1", title: "Entry", dashboardId: "d-1", dashboardName: "Ops" },
          { id: "pn-2", title: "no dashboard" },
        ],
        hiddenPipelineCount: 2,
        hiddenPanelCount: "x",
      }),
    );
    const result = await makeStore().dispatch(deleteSource("s-1"));
    expect(deleteSource.rejected.match(result)).toBe(true);
    const payload = (result as { payload: unknown }).payload;
    expect(isSourceDeleteConflict(payload)).toBe(true);
    expect(payload).toEqual({
      kind: "conflict",
      message: "this source is still referenced by pipeline(s) 'Sales' (p-1); remove it first",
      pipelines: [{ id: "p-1", name: "Sales", references: ["root", "join"] }],
      panels: [{ id: "pn-1", title: "Entry", dashboardId: "d-1", dashboardName: "Ops" }],
      hiddenPipelineCount: 2,
      hiddenPanelCount: undefined,
    });
  });

  it("parses a pre-HEL-1252 body (no panels, no references) tolerantly as empty", async () => {
    deleteSourceMock.mockRejectedValue(
      axios409({ message: "old server", pipelines: [{ id: "p-1", name: "Sales" }] }),
    );
    const result = await makeStore().dispatch(deleteSource("s-1"));
    expect((result as { payload: unknown }).payload).toEqual({
      kind: "conflict",
      message: "old server",
      pipelines: [{ id: "p-1", name: "Sales", references: [] }],
      panels: [],
    });
  });

  it("keeps the generic string rejection for any non-409 failure", async () => {
    deleteSourceMock.mockRejectedValue(new Error("boom"));
    const result = await makeStore().dispatch(deleteSource("s-1"));
    expect((result as { payload: unknown }).payload).toBe("Failed to delete source.");
  });
});

describe("sourcesSlice — reference summary (HEL-1258)", () => {
  const fetchRefsMock = jest.mocked(dataSourceService.fetchSourceReferences);
  const deleteMock = jest.mocked(dataSourceService.deleteSource);
  const summary = {
    sourceId: "s-1",
    pipelines: [{ id: "p-1", name: "Joined", references: ["join"] }],
    panels: [],
    hiddenPipelineCount: 0,
    hiddenPanelCount: 1,
  };

  beforeEach(() => {
    fetchRefsMock.mockReset();
    deleteMock.mockReset();
  });

  it("stores the summary keyed by source id and marks it loaded", async () => {
    fetchRefsMock.mockResolvedValue([summary]);
    const store = configureStore({ reducer: { sources: sourcesReducer } });
    expect(store.getState().sources.referencesStatus).toBe("idle");
    await store.dispatch(fetchSourceReferences());
    expect(store.getState().sources.references).toEqual({ "s-1": summary });
    expect(store.getState().sources.referencesStatus).toBe("succeeded");
  });

  it("issues ONE request when dispatched twice while loading (cold /sources: page + sidebar)", async () => {
    fetchRefsMock.mockResolvedValue([summary]);
    const store = configureStore({ reducer: { sources: sourcesReducer } });
    await Promise.all([
      store.dispatch(fetchSourceReferences()),
      store.dispatch(fetchSourceReferences()),
    ]);
    expect(fetchRefsMock).toHaveBeenCalledTimes(1);
  });

  it("marks failed (never loaded) on a fetch error, so 'Unused' is never claimed", async () => {
    fetchRefsMock.mockRejectedValue(new Error("boom"));
    const store = configureStore({ reducer: { sources: sourcesReducer } });
    await store.dispatch(fetchSourceReferences());
    expect(store.getState().sources.referencesStatus).toBe("failed");
  });

  it("drops the deleted source's entry when deleteSource fulfills", async () => {
    fetchRefsMock.mockResolvedValue([summary]);
    deleteMock.mockResolvedValue(undefined);
    const store = configureStore({ reducer: { sources: sourcesReducer } });
    await store.dispatch(fetchSourceReferences());
    await store.dispatch(deleteSource("s-1"));
    expect(store.getState().sources.references).toEqual({});
  });

  it("refetches the summary when a delete is refused", async () => {
    fetchRefsMock.mockResolvedValue([]);
    deleteMock.mockRejectedValue(new Error("409"));
    const store = configureStore({ reducer: { sources: sourcesReducer } });
    await store.dispatch(deleteSource("s-1"));
    await Promise.resolve();
    expect(fetchRefsMock).toHaveBeenCalledTimes(1);
  });
});
