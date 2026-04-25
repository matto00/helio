import { dataTypesReducer, deleteDataType, fetchDataTypes, updateDataType } from "./dataTypesSlice";

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
      fetchDataTypes.rejected(null, "req-1", undefined, "Failed to load data types."),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load data types.");
  });
});

describe("deleteDataType", () => {
  const stateWithItem = {
    items: [testDataType],
    status: "succeeded" as const,
    error: null,
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
    // Items unchanged on rejection
    expect(nextState.items).toHaveLength(1);
  });
});

describe("updateDataType", () => {
  it("updates the item in place when fulfilled", () => {
    const stateWithItem = {
      items: [testDataType],
      status: "succeeded" as const,
      error: null,
    };
    const updatedType = { ...testDataType, name: "Updated Metrics" };
    const nextState = dataTypesReducer(
      stateWithItem,
      updateDataType.fulfilled(updatedType, "req-5", { id: "dt-1", fields: updatedType.fields }),
    );
    expect(nextState.items[0].name).toBe("Updated Metrics");
  });
});
