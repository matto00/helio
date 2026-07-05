// Regression coverage for the wire-shape gap that broke type filtering: the
// backend's spray-json serialization omits `sourceId` entirely for
// pipeline-output DataTypes (Option = None is dropped, not written as null),
// so the service must normalize the absent key to `null` before the value
// reaches the store, where `sourceId === null` checks are relied upon.

import { httpClient } from "../../../services/httpClient";
import { fetchDataTypes, updateDataType } from "./dataTypeService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), patch: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

const wireCompanion = {
  id: "dt-companion",
  sourceId: "src-1",
  name: "Companion",
  fields: [],
  computedFields: [],
  version: 1,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

// No `sourceId` key at all — exactly how a pipeline-output type arrives.
const wirePipelineOutput = {
  id: "dt-output",
  name: "Output",
  fields: [],
  computedFields: [],
  version: 1,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("dataTypeService sourceId normalization", () => {
  it("fetchDataTypes maps an absent sourceId to null and preserves a present one", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: { items: [wireCompanion, wirePipelineOutput], total: 2, offset: 0, limit: 200 },
    });

    const result = await fetchDataTypes();

    expect(result[0].sourceId).toBe("src-1");
    expect(result[1].sourceId).toBeNull();
  });

  it("updateDataType maps an absent sourceId to null", async () => {
    mockedHttpClient.patch.mockResolvedValueOnce({ data: wirePipelineOutput });

    const result = await updateDataType("dt-output", []);

    expect(result.sourceId).toBeNull();
  });
});
