// HEL-1773: the app opts in to named-grant dashboards with `include=shared`; a caller that wants only the dashboards the
// user owns (the dev-only patch-set demo) leaves it off. The per-panel routes take no token for a signed-in grantee.
import { httpClient } from "../../../services/httpClient";
import { fetchDashboards } from "./dashboardService";
import { fetchPublicOutputMeta, fetchPublicPanelRows } from "./publicDashboardService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn() },
}));

const get = jest.mocked(httpClient.get);

describe("fetchDashboards include=shared", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({ data: { items: [] } });
  });

  it("passes include=shared by default", async () => {
    await fetchDashboards();
    expect(get).toHaveBeenCalledWith("/api/dashboards", { params: { include: "shared" } });
  });

  it("omits it for an owner-only list", async () => {
    await fetchDashboards({ includeShared: false });
    expect(get).toHaveBeenCalledWith("/api/dashboards", { params: undefined });
  });
});

describe("per-panel reads without a share token", () => {
  beforeEach(() => {
    get.mockReset();
    get.mockResolvedValue({
      data: { items: [], total: 0, offset: 0, limit: 50, kind: "table", config: {}, schema: [] },
    });
  });

  it("rows: no token param when the token is absent, the token when given", async () => {
    await fetchPublicPanelRows("d1", "p1", undefined, 0, 50);
    expect(get).toHaveBeenLastCalledWith("/api/dashboards/d1/panels/p1/rows", {
      params: { offset: 0, limit: 50 },
    });
    await fetchPublicPanelRows("d1", "p1", "tok", 0, 50);
    expect(get).toHaveBeenLastCalledWith("/api/dashboards/d1/panels/p1/rows", {
      params: { token: "tok", offset: 0, limit: 50 },
    });
  });

  it("output-meta: no params without a token", async () => {
    await fetchPublicOutputMeta("d1", "p1");
    expect(get).toHaveBeenLastCalledWith("/api/dashboards/d1/panels/p1/output-meta", {
      params: undefined,
    });
  });
});
