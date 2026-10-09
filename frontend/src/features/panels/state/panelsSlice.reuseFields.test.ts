import { CROSS_FILTER_EQ_REJECTED } from "./panelThunks";
import { fetchPanelPage, panelsReducer } from "./panelsSlice";

// HEL-1392 design.md D2 -- the bookkeeping a remounting card reads to decide whether a window is
// reusable: did the latest page-0 request succeed, under which generation, and why did it fail.
const arg0 = { panelId: "p", outputId: "o", page: 0, pageSize: 200 };
const arg1 = { panelId: "p", outputId: "o", page: 1, pageSize: 50 };
const payload = (page: number, generation: number) => ({
  panelId: "p",
  page,
  rows: [{ n: page }],
  hasMore: false,
  materialized: true,
  total: 1,
  generation,
});

function settledWindow() {
  const pending = panelsReducer(undefined, fetchPanelPage.pending("r0", arg0));
  return panelsReducer(pending, fetchPanelPage.fulfilled(payload(0, 7), "r0", arg0));
}

describe("paginationState reuse bookkeeping", () => {
  it("a pending page-0 request is not reusable and clears the previous failure", () => {
    const failed = panelsReducer(
      panelsReducer(undefined, fetchPanelPage.pending("r0", arg0)),
      fetchPanelPage.rejected(null, "r0", arg0, { message: "x", kind: "error" }),
    );
    const next = panelsReducer(failed, fetchPanelPage.pending("r1", arg0));
    const entry = next.paginationState["p"];
    expect(entry.lastFetchOk).toBeUndefined();
    expect(entry.lastError).toBeNull();
  });

  it("a fulfilled page 0 records success and its generation", () => {
    const entry = settledWindow().paginationState["p"];
    expect(entry.lastFetchOk).toBe(true);
    expect(entry.generation).toBe(7);
    expect(entry.lastError).toBeNull();
  });

  it("a load-more leaves success, generation and error as they were", () => {
    let state = settledWindow();
    state = panelsReducer(state, fetchPanelPage.pending("r1", arg1));
    expect(state.paginationState["p"].lastFetchOk).toBe(true);
    state = panelsReducer(state, fetchPanelPage.fulfilled(payload(1, 9), "r1", arg1));
    expect(state.paginationState["p"].lastFetchOk).toBe(true);
    expect(state.paginationState["p"].generation).toBe(7);
  });

  it("a failed load-more does not make the window unreusable", () => {
    let state = settledWindow();
    state = panelsReducer(state, fetchPanelPage.pending("r1", arg1));
    state = panelsReducer(
      state,
      fetchPanelPage.rejected(null, "r1", arg1, { message: "x", kind: "error" }),
    );
    expect(state.paginationState["p"].lastFetchOk).toBe(true);
    expect(state.paginationState["p"].lastError).toBeNull();
  });

  it("a failed page 0 is never reusable and keeps its failure with the request id", () => {
    let state = settledWindow();
    state = panelsReducer(state, fetchPanelPage.pending("r2", arg0));
    state = panelsReducer(
      state,
      fetchPanelPage.rejected(null, "r2", arg0, { message: "Rate limit exceeded", kind: "error" }),
    );
    const entry = state.paginationState["p"];
    expect(entry.lastFetchOk).toBe(false);
    expect(entry.lastError).toEqual({
      requestId: "r2",
      message: "Rate limit exceeded",
      kind: "error",
    });
  });

  it("a self-healing cross-filter rejection is not reusable but is never an error state", () => {
    let state = panelsReducer(undefined, fetchPanelPage.pending("r0", arg0));
    state = panelsReducer(
      state,
      fetchPanelPage.rejected(null, "r0", arg0, {
        message: "x",
        kind: "error",
        code: CROSS_FILTER_EQ_REJECTED,
      }),
    );
    expect(state.paginationState["p"].lastFetchOk).toBe(false);
    expect(state.paginationState["p"].lastError).toBeNull();
  });

  it("ignores a superseded request's outcome", () => {
    let state = panelsReducer(undefined, fetchPanelPage.pending("old", arg0));
    state = panelsReducer(state, fetchPanelPage.pending("new", arg0));
    state = panelsReducer(
      state,
      fetchPanelPage.rejected(null, "old", arg0, { message: "x", kind: "error" }),
    );
    expect(state.paginationState["p"].lastFetchOk).toBeUndefined();
    expect(state.paginationState["p"].isLoadingMore).toBe(true);
  });
});
