// Documents the wire shape of the web client's layout save (HEL-1071, design task 2.4): the route is
// `PATCH /api/dashboards/:id/update` with the batch envelope, and ONLY the breakpoints passed are sent
// (a partial PATCH — the server preserves the rest). The server's rule is "identical to stored passes
// untouched", not "absent only", because a stale or older client may still send all four.
import { httpClient } from "../../../services/httpClient";
import { updateDashboardLayout } from "./dashboardService";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { patch: jest.fn() },
}));

const mockedPatch = jest.mocked(httpClient.patch);

describe("updateDashboardLayout", () => {
  beforeEach(() => {
    mockedPatch.mockReset();
    mockedPatch.mockResolvedValue({ data: { id: "d1" } });
  });

  it("PATCHes the batch route with only the breakpoints supplied", async () => {
    const xs = [{ panelId: "a", x: 0, y: 0, w: 2, h: 3 }];
    await updateDashboardLayout("d1", { xs });
    expect(mockedPatch).toHaveBeenCalledTimes(1);
    expect(mockedPatch).toHaveBeenCalledWith("/api/dashboards/d1/update", {
      fields: ["layout"],
      dashboard: { layout: { xs } },
    });
  });

  it("sends all four when all four are supplied", async () => {
    const item = [{ panelId: "a", x: 0, y: 0, w: 2, h: 3 }];
    await updateDashboardLayout("d1", { lg: item, md: item, sm: item, xs: item });
    const body = mockedPatch.mock.calls[0][1] as { dashboard: { layout: object } };
    expect(Object.keys(body.dashboard.layout)).toEqual(["lg", "md", "sm", "xs"]);
  });
});
