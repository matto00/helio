import { dataTypesReducer, fetchDataTypes } from "./dataTypesSlice";

const testDataType = {
  id: "dt-1",
  name: "Metrics",
  sourceId: "s-1",
  version: 1,
  fields: [{ name: "value", displayName: "Value", dataType: "float", nullable: false }],
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
