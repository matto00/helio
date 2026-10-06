import { httpClient } from "../../../services/httpClient";
import {
  fetchHistoryPointRows,
  fetchOutputHistory,
  fetchPublicOutputHistory,
} from "./outputHistoryService";

jest.mock("../../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));
const get = jest.mocked(httpClient.get);

describe("outputHistoryService", () => {
  beforeEach(() => get.mockReset().mockResolvedValue({ data: { compare: null } }));

  it("reads the authenticated route", async () => {
    await fetchOutputHistory("out-1");
    expect(get).toHaveBeenCalledWith("/api/outputs/out-1/history", { params: undefined });
  });

  it("passes limit as a query param when supplied", async () => {
    await fetchOutputHistory("out-1", { limit: 100 });
    expect(get).toHaveBeenCalledWith("/api/outputs/out-1/history", { params: { limit: 100 } });
  });

  it("reads a point's stored rows", async () => {
    get.mockResolvedValue({ data: { rows: [{ a: 1 }], rowCount: 1 } });
    await expect(fetchHistoryPointRows("out-1", "pt-1")).resolves.toEqual({
      rows: [{ a: 1 }],
      rowCount: 1,
    });
    expect(get).toHaveBeenCalledWith("/api/outputs/out-1/history/pt-1/rows");
  });

  it("reads the public panel route with the share token as a query param", async () => {
    await fetchPublicOutputHistory("dash-1", "panel-1", "tok");
    expect(get).toHaveBeenCalledWith("/api/dashboards/dash-1/panels/panel-1/history", {
      params: { token: "tok" },
    });
  });
});
