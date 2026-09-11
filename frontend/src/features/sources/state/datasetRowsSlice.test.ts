import {
  datasetRowsReducer,
  fetchDatasetRowsPage,
  fetchDatasetSchemaThunk,
  patchDatasetRow,
  deleteDatasetRow,
  refetchConflict,
  markRowDeleted,
  popCursorStack,
  pushCursorStack,
  resetCursorStack,
} from "./datasetRowsSlice";
import type { RowResponseRow } from "../types/dataSource";

const sourceId = "src-1";
const row1: RowResponseRow = { id: "r1", seq: 0, updatedAt: "2026-01-01T00:00:00Z", data: ["a"] };
const row2: RowResponseRow = { id: "r2", seq: 1, updatedAt: "2026-01-01T00:00:00Z", data: ["b"] };

describe("datasetRowsSlice", () => {
  it("fetchDatasetSchemaThunk.fulfilled stores the schema", () => {
    const schema = { fields: [{ name: "a", type: "string" as const, required: false }] };
    let state = datasetRowsReducer(undefined, fetchDatasetSchemaThunk.pending("req", { sourceId }));
    expect(state.bySource[sourceId].schemaStatus).toBe("loading");
    state = datasetRowsReducer(
      state,
      fetchDatasetSchemaThunk.fulfilled({ sourceId, schema }, "req", { sourceId }),
    );
    expect(state.bySource[sourceId].schema).toEqual(schema);
    expect(state.bySource[sourceId].schemaStatus).toBe("succeeded");
  });

  it("fetchDatasetRowsPage.fulfilled populates rows/total", () => {
    const state = datasetRowsReducer(
      undefined,
      fetchDatasetRowsPage.fulfilled(
        { sourceId, page: { rows: [row1, row2], total: 2 }, cursor: undefined },
        "req",
        { sourceId },
      ),
    );
    expect(state.bySource[sourceId].rows).toEqual([row1, row2]);
    expect(state.bySource[sourceId].total).toBe(2);
    expect(state.bySource[sourceId].rowsStatus).toBe("succeeded");
    expect(state.bySource[sourceId].nextCursor).toBeUndefined();
  });

  it("fetchDatasetRowsPage.fulfilled records a defined nextCursor when more rows remain", () => {
    const state = datasetRowsReducer(
      undefined,
      fetchDatasetRowsPage.fulfilled(
        { sourceId, page: { rows: [row1], total: 200, nextCursor: 100 }, cursor: undefined },
        "req",
        { sourceId },
      ),
    );
    expect(state.bySource[sourceId].nextCursor).toBe(100);
  });

  it("patchDatasetRow.fulfilled replaces the matching row and clears pending/conflict", () => {
    let state = datasetRowsReducer(
      undefined,
      fetchDatasetRowsPage.fulfilled(
        { sourceId, page: { rows: [row1], total: 1 }, cursor: undefined },
        "req",
        {
          sourceId,
        },
      ),
    );
    state = datasetRowsReducer(
      state,
      patchDatasetRow.pending("req2", {
        sourceId,
        rowId: "r1",
        updatedAt: row1.updatedAt,
        data: ["z"],
      }),
    );
    expect(state.bySource[sourceId].pending["r1"]).toBe(true);

    const updatedRow: RowResponseRow = { ...row1, data: ["z"], updatedAt: "2026-01-02T00:00:00Z" };
    state = datasetRowsReducer(
      state,
      patchDatasetRow.fulfilled({ sourceId, row: updatedRow }, "req2", {
        sourceId,
        rowId: "r1",
        updatedAt: row1.updatedAt,
        data: ["z"],
      }),
    );
    expect(state.bySource[sourceId].rows[0]).toEqual(updatedRow);
    expect(state.bySource[sourceId].pending["r1"]).toBeUndefined();
  });

  it("deleteDatasetRow.fulfilled removes the row and decrements total", () => {
    let state = datasetRowsReducer(
      undefined,
      fetchDatasetRowsPage.fulfilled(
        { sourceId, page: { rows: [row1, row2], total: 2 }, cursor: undefined },
        "req",
        { sourceId },
      ),
    );
    state = datasetRowsReducer(
      state,
      deleteDatasetRow.fulfilled({ sourceId, rowId: "r1" }, "req2", {
        sourceId,
        rowId: "r1",
        updatedAt: row1.updatedAt,
      }),
    );
    expect(state.bySource[sourceId].rows.map((r) => r.id)).toEqual(["r2"]);
    expect(state.bySource[sourceId].total).toBe(1);
  });

  it("refetchConflict.fulfilled records a present (retryable) conflict", () => {
    const state = datasetRowsReducer(
      undefined,
      refetchConflict.fulfilled({ sourceId, rowId: "r1", action: "edit", current: row1 }, "req", {
        sourceId,
        rowId: "r1",
        action: "edit",
      }),
    );
    expect(state.bySource[sourceId].conflicts["r1"]).toEqual({
      rowId: "r1",
      current: row1,
      deleted: false,
      action: "edit",
    });
  });

  it("refetchConflict.fulfilled with a null current row records a deleted conflict", () => {
    const state = datasetRowsReducer(
      undefined,
      refetchConflict.fulfilled({ sourceId, rowId: "r1", action: "delete", current: null }, "req", {
        sourceId,
        rowId: "r1",
        action: "delete",
      }),
    );
    expect(state.bySource[sourceId].conflicts["r1"].deleted).toBe(true);
  });

  it("pushCursorStack/popCursorStack maintain the page stack (design.md Decision 0a)", () => {
    let state = datasetRowsReducer(undefined, pushCursorStack({ sourceId, cursor: 5 }));
    expect(state.bySource[sourceId].cursorStack).toEqual([undefined, 5]);
    state = datasetRowsReducer(state, popCursorStack({ sourceId }));
    expect(state.bySource[sourceId].cursorStack).toEqual([undefined]);
    // Never pops the first (page-1) entry.
    state = datasetRowsReducer(state, popCursorStack({ sourceId }));
    expect(state.bySource[sourceId].cursorStack).toEqual([undefined]);
  });

  it("resetCursorStack (skeptic-final-2.md CR-C) discards any prior stack back to just page 1", () => {
    let state = datasetRowsReducer(undefined, pushCursorStack({ sourceId, cursor: 5 }));
    state = datasetRowsReducer(state, pushCursorStack({ sourceId, cursor: 10 }));
    expect(state.bySource[sourceId].cursorStack).toEqual([undefined, 5, 10]);
    state = datasetRowsReducer(state, resetCursorStack({ sourceId }));
    expect(state.bySource[sourceId].cursorStack).toEqual([undefined]);
  });

  it("markRowDeleted (skeptic-final-2.md CR-A) records a deleted conflict and removes the row synchronously, no re-fetch", () => {
    let state = datasetRowsReducer(
      undefined,
      fetchDatasetRowsPage.fulfilled(
        { sourceId, page: { rows: [row1, row2], total: 2 }, cursor: undefined },
        "req",
        { sourceId },
      ),
    );
    state = datasetRowsReducer(state, markRowDeleted({ sourceId, rowId: "r1", action: "edit" }));
    expect(state.bySource[sourceId].conflicts["r1"]).toEqual({
      rowId: "r1",
      current: null,
      deleted: true,
      action: "edit",
    });
    expect(state.bySource[sourceId].rows.map((r) => r.id)).toEqual(["r2"]);
    expect(state.bySource[sourceId].total).toBe(1);
  });
});
