// HEL-1197: the public output-meta wire no longer carries `ownerId`; `fetchPublicOutputMeta` still
// reconstructs `ownerId: null` so a write-capable renderer prop can never see a real owner id
// (`canWrite` stays false publicly), and never spreads the raw wire object.

import { httpClient } from "../../../services/httpClient";
import { fetchPublicOutputMeta } from "./publicDashboardService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

describe("fetchPublicOutputMeta", () => {
  it("returns exactly kind/config/schema plus ownerId: null from an ownerId-free wire", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: { kind: "table", config: {}, schema: [{ name: "a", type: "string" }] },
    });
    const meta = await fetchPublicOutputMeta("d1", "p1", "tok");
    expect(mockedHttpClient.get).toHaveBeenCalledWith("/api/dashboards/d1/panels/p1/output-meta", {
      params: { token: "tok" },
    });
    expect(meta).toEqual({
      kind: "table",
      config: {},
      schema: [{ name: "a", type: "string" }],
      ownerId: null,
    });
  });

  it("discards an ownerId an older backend might still send", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: { kind: "table", config: {}, schema: [], ownerId: "real-owner" },
    });
    expect((await fetchPublicOutputMeta("d1", "p1", "tok")).ownerId).toBeNull();
  });
});
