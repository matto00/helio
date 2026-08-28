import { configureStore } from "@reduxjs/toolkit";

import {
  dataTypesReducer,
  deleteDataType,
  fetchAssertionStatus,
  fetchDataTypes,
  selectAssertionInvalid,
  selectPipelineOutputDataTypes,
  updateDataType,
} from "./dataTypesSlice";
import * as dataTypeService from "../services/dataTypeService";
import type { RootState } from "../../../store/store";

const testDataType = {
  id: "dt-1",
  name: "Metrics",
  sourceId: "s-1",
  version: 1,
  fields: [{ name: "value", displayName: "Value", dataType: "float", nullable: false }],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

describe("dataTypesSlice", () => {
  it("populates items when fetchDataTypes fulfills", () => {
    const nextState = dataTypesReducer(
      undefined,
      fetchDataTypes.fulfilled([testDataType], "req-1"),
    );
    expect(nextState.items).toHaveLength(1);
    expect(nextState.items[0].name).toBe("Metrics");
    expect(nextState.status).toBe("succeeded");
    expect(nextState.error).toBeNull();
  });

  it("sets loading status on pending", () => {
    const nextState = dataTypesReducer(undefined, fetchDataTypes.pending("req-1"));
    expect(nextState.status).toBe("loading");
  });

  it("sets error when fetchDataTypes rejects", () => {
    const nextState = dataTypesReducer(
      undefined,
      fetchDataTypes.rejected(null, "req-1", undefined, {
        message: "Failed to load data types.",
        kind: "error",
      }),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load data types.");
    expect(nextState.errorKind).toBe("error");
  });
});

describe("deleteDataType", () => {
  const stateWithItem = {
    items: [testDataType],
    status: "succeeded" as const,
    error: null,
    errorKind: null,
    selectedTypeId: null,
    assertionStatusByDataTypeId: {},
    assertionStatusPendingIds: {},
  };

  it("removes the data type from items when fulfilled", () => {
    const nextState = dataTypesReducer(
      stateWithItem,
      deleteDataType.fulfilled("dt-1", "req-2", "dt-1"),
    );
    expect(nextState.items).toHaveLength(0);
  });

  it("does not modify items when a different id is fulfilled", () => {
    const nextState = dataTypesReducer(
      stateWithItem,
      deleteDataType.fulfilled("dt-999", "req-3", "dt-999"),
    );
    expect(nextState.items).toHaveLength(1);
  });

  it("carries rejectValue for 409 conflict", () => {
    const nextState = dataTypesReducer(
      stateWithItem,
      deleteDataType.rejected(
        null,
        "req-4",
        "dt-1",
        "One or more panels are bound to this type. Unbind them before deleting.",
      ),
    );
    expect(nextState.items).toHaveLength(1);
  });
});

describe("updateDataType", () => {
  it("updates the item in place when fulfilled", () => {
    const stateWithItem = {
      items: [testDataType],
      status: "succeeded" as const,
      error: null,
      errorKind: null,
      selectedTypeId: null,
      assertionStatusByDataTypeId: {},
      assertionStatusPendingIds: {},
    };
    const updatedType = { ...testDataType, name: "Updated Metrics" };
    const nextState = dataTypesReducer(
      stateWithItem,
      updateDataType.fulfilled(updatedType, "req-5", { id: "dt-1", fields: updatedType.fields }),
    );
    expect(nextState.items[0].name).toBe("Updated Metrics");
  });
});

// Task 2.2 — companion DataTypes (sourceId set) are internal source-schema
// records; only pipeline-output DataTypes (sourceId === null) are bindable.
describe("selectPipelineOutputDataTypes", () => {
  const companionType = testDataType; // sourceId: "s-1"
  const pipelineOutputType = {
    ...testDataType,
    id: "dt-2",
    name: "Pipeline Output",
    sourceId: null,
  };

  it("excludes companion DataTypes (sourceId set)", () => {
    const state = { dataTypes: { items: [companionType], status: "succeeded" as const } };
    expect(selectPipelineOutputDataTypes(state as unknown as RootState)).toEqual([]);
  });

  it("includes pipeline-output DataTypes (sourceId null)", () => {
    const state = {
      dataTypes: { items: [companionType, pipelineOutputType], status: "succeeded" as const },
    };
    expect(selectPipelineOutputDataTypes(state as unknown as RootState)).toEqual([
      pipelineOutputType,
    ]);
  });

  // Task 2.1 — memoization must yield the same array reference for repeated
  // calls with an unchanged `dataTypes.items` reference, so React-Redux render
  // bailout succeeds and the "different result" warning is suppressed (HEL-312).
  it("returns the same reference across repeated calls with unchanged items", () => {
    const items = [companionType, pipelineOutputType];
    const state = { dataTypes: { items, status: "succeeded" as const } } as unknown as RootState;
    const first = selectPipelineOutputDataTypes(state);
    const second = selectPipelineOutputDataTypes(state);
    expect(second).toBe(first);
  });

  // Task 2.2 — stability holds across an unrelated state change (same `items`
  // reference in a new state object), and a replaced `items` array recomputes.
  it("keeps a stable reference across an unrelated state change", () => {
    const items = [companionType, pipelineOutputType];
    const stateBefore = {
      dataTypes: { items, status: "loading" as const },
    } as unknown as RootState;
    const first = selectPipelineOutputDataTypes(stateBefore);
    // Unrelated slice-level change; `items` array reference is untouched.
    const stateAfter = {
      dataTypes: { items, status: "succeeded" as const },
      pipelines: { items: [] },
    } as unknown as RootState;
    const second = selectPipelineOutputDataTypes(stateAfter);
    expect(second).toBe(first);
  });

  it("recomputes a new array when items is replaced", () => {
    const stateBefore = {
      dataTypes: { items: [companionType, pipelineOutputType], status: "succeeded" as const },
    } as unknown as RootState;
    const first = selectPipelineOutputDataTypes(stateBefore);
    const stateAfter = {
      dataTypes: { items: [pipelineOutputType], status: "succeeded" as const },
    } as unknown as RootState;
    const second = selectPipelineOutputDataTypes(stateAfter);
    expect(second).not.toBe(first);
    expect(second).toEqual([pipelineOutputType]);
  });
});

// HEL-576 (design.md Decision 8) — the assertion-status thunk dedupes
// concurrent/repeated fetches for the same dataTypeId.
describe("fetchAssertionStatus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("dedupes two concurrently-dispatched fetches for the same dataTypeId into one request", async () => {
    const spy = jest.spyOn(dataTypeService, "fetchAssertionStatus").mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: true,
      failedRuleCount: 2,
    });
    const store = configureStore({ reducer: { dataTypes: dataTypesReducer } });

    await Promise.all([
      // @ts-expect-error — test store has fewer slices than the full RootState
      store.dispatch(fetchAssertionStatus("dt-1")),
      // @ts-expect-error — test store has fewer slices than the full RootState
      store.dispatch(fetchAssertionStatus("dt-1")),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.getState().dataTypes.assertionStatusByDataTypeId["dt-1"]).toEqual({
      invalid: true,
      failedRuleCount: 2,
    });
  });

  it("is a no-op for a dataTypeId whose status is already cached", async () => {
    const spy = jest.spyOn(dataTypeService, "fetchAssertionStatus").mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: false,
      failedRuleCount: 0,
    });
    const store = configureStore({ reducer: { dataTypes: dataTypesReducer } });

    // @ts-expect-error — test store has fewer slices than the full RootState
    await store.dispatch(fetchAssertionStatus("dt-1"));
    // @ts-expect-error — test store has fewer slices than the full RootState
    await store.dispatch(fetchAssertionStatus("dt-1"));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fetches independently for distinct dataTypeIds", async () => {
    const spy = jest
      .spyOn(dataTypeService, "fetchAssertionStatus")
      .mockImplementation(async (id) => ({ dataTypeId: id, invalid: false, failedRuleCount: 0 }));
    const store = configureStore({ reducer: { dataTypes: dataTypesReducer } });

    // @ts-expect-error — test store has fewer slices than the full RootState
    await store.dispatch(fetchAssertionStatus("dt-1"));
    // @ts-expect-error — test store has fewer slices than the full RootState
    await store.dispatch(fetchAssertionStatus("dt-2"));

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith("dt-1");
    expect(spy).toHaveBeenCalledWith("dt-2");
  });
});

describe("selectAssertionInvalid", () => {
  it("returns false for a null dataTypeId", () => {
    const state = { dataTypes: { assertionStatusByDataTypeId: {} } } as unknown as RootState;
    expect(selectAssertionInvalid(state, null)).toBe(false);
  });

  it("returns false when the status is not yet cached", () => {
    const state = { dataTypes: { assertionStatusByDataTypeId: {} } } as unknown as RootState;
    expect(selectAssertionInvalid(state, "dt-1")).toBe(false);
  });

  it("returns the cached invalid value", () => {
    const state = {
      dataTypes: { assertionStatusByDataTypeId: { "dt-1": { invalid: true, failedRuleCount: 3 } } },
    } as unknown as RootState;
    expect(selectAssertionInvalid(state, "dt-1")).toBe(true);
  });
});
