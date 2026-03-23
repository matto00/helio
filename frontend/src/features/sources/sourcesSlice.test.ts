import { deleteSource, fetchSources, sourcesReducer } from "./sourcesSlice";

const testSource = {
  id: "s-1",
  name: "Sales API",
  sourceType: "rest_api",
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

describe("sourcesSlice", () => {
  it("populates items when fetchSources fulfills", () => {
    const nextState = sourcesReducer(
      undefined,
      fetchSources.fulfilled([testSource], "req-1"),
    );
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
});
