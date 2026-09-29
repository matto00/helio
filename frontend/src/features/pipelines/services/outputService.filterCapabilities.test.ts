// HEL-1189 tasks.md 3.1 — `getFilterCapabilities` request/response shape, asserted against
// `schemas/outputs/output-filter-capabilities-response.schema.json` (HEL-1188).

import { httpClient } from "../../../services/httpClient";
import { getFilterCapabilities } from "./outputService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

describe("outputService.getFilterCapabilities", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GETs /api/outputs/:id/filter-capabilities", async () => {
    mockedHttpClient.get.mockResolvedValue({ data: { columns: [] } });

    await getFilterCapabilities("out-1");

    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/outputs/out-1/filter-capabilities");
  });

  it("returns the response shape the schema declares — columns[].{column, operators}", async () => {
    const responseData = {
      columns: [
        { column: "created_at", operators: ["contains", "gte", "lte"] },
        { column: "region", operators: ["contains", "eq", "in"] },
      ],
    };
    mockedHttpClient.get.mockResolvedValue({ data: responseData });

    const result = await getFilterCapabilities("out-1");

    expect(result).toEqual(responseData);
    // Schema: "required": ["columns"], additionalProperties: false at both levels.
    expect(Object.keys(result)).toEqual(["columns"]);
    result.columns.forEach((c) => {
      expect(Object.keys(c).sort()).toEqual(["column", "operators"]);
      expect(typeof c.column).toBe("string");
      expect(Array.isArray(c.operators)).toBe(true);
      c.operators.forEach((op) => {
        expect(["contains", "gte", "lte", "eq", "in"]).toContain(op);
      });
    });
  });

  it("an empty columns array round-trips (a column with no eligible operators is omitted, never empty-operators)", async () => {
    mockedHttpClient.get.mockResolvedValue({ data: { columns: [] } });

    const result = await getFilterCapabilities("out-1");

    expect(result.columns).toEqual([]);
  });
});
