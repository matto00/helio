// Unit coverage for `fetchOutputs`'s pagination loop (HEL-907 task 4.1) --
// mirrors `helio-mcp/src/context.ts`'s own `fetchAllOutputs` test coverage
// for the same shape of function.

import { httpClient } from "../../../services/httpClient";
import { fetchOutputs } from "./outputsService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

beforeEach(() => {
  jest.clearAllMocks();
});

describe("fetchOutputs", () => {
  it("returns every item from a single page", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        items: [
          { id: "out-1", name: "Sales" },
          { id: "out-2", name: "Revenue" },
        ],
        total: 2,
        offset: 0,
        limit: 200,
      },
    });

    const result = await fetchOutputs();

    expect(result).toEqual([
      { id: "out-1", name: "Sales" },
      { id: "out-2", name: "Revenue" },
    ]);
    expect(mockedHttpClient.get).toHaveBeenCalledTimes(1);
    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/outputs", {
      params: { offset: 0, limit: 200 },
    });
  });

  it("fetches every page when the caller owns more than one page's worth of Outputs", async () => {
    const page1Items = Array.from({ length: 200 }, (_, i) => ({ id: `out-${i}`, name: `O${i}` }));
    const page2Items = [{ id: "out-200", name: "O200" }];
    mockedHttpClient.get
      .mockResolvedValueOnce({ data: { items: page1Items, total: 201, offset: 0, limit: 200 } })
      .mockResolvedValueOnce({ data: { items: page2Items, total: 201, offset: 200, limit: 200 } });

    const result = await fetchOutputs();

    expect(result).toHaveLength(201);
    expect(mockedHttpClient.get).toHaveBeenCalledTimes(2);
    expect(mockedHttpClient.get).toHaveBeenNthCalledWith(2, "/api/outputs", {
      params: { offset: 200, limit: 200 },
    });
  });

  it("returns [] for a caller with no Outputs", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: { items: [], total: 0, offset: 0, limit: 200 },
    });

    const result = await fetchOutputs();

    expect(result).toEqual([]);
  });
});
