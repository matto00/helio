import { httpClient } from "../../../services/httpClient";
import { fetchOutputHistory, fetchPublicOutputHistory } from "./outputHistoryService";

jest.mock("../../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));
const get = jest.mocked(httpClient.get);

describe("outputHistoryService", () => {
  beforeEach(() => get.mockReset().mockResolvedValue({ data: { compare: null } }));

  it("reads the authenticated route", async () => {
    await fetchOutputHistory("out-1");
    expect(get).toHaveBeenCalledWith("/api/outputs/out-1/history");
  });

  it("reads the public panel route with the share token as a query param", async () => {
    await fetchPublicOutputHistory("dash-1", "panel-1", "tok");
    expect(get).toHaveBeenCalledWith("/api/dashboards/dash-1/panels/panel-1/history", {
      params: { token: "tok" },
    });
  });
});
