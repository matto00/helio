// HEL-1587: the public panel list now also carries the stored layout, and a form's bound-field declarations are readable.
import { httpClient } from "../../../services/httpClient";
import { fetchPublicDashboardPanels, fetchPublicFormSchema } from "./publicDashboardService";

describe("publicDashboardService (HEL-1587)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("fetchPublicDashboardPanels resolves the items and the layout", async () => {
    const layout = { lg: [{ panelId: "p", x: 0, y: 0, w: 6, h: 5 }], md: [], sm: [], xs: [] };
    const get = jest.spyOn(httpClient, "get").mockResolvedValue({
      data: { items: [{ id: "p" }], total: 1, offset: 0, limit: 50, layout },
    });
    const result = await fetchPublicDashboardPanels("d1", "tok");
    expect(get).toHaveBeenCalledWith("/api/dashboards/d1/panels", { params: { token: "tok" } });
    expect(result.panels).toEqual([{ id: "p" }]);
    expect(result.layout).toEqual(layout);
  });

  it("degrades a response with no layout to empty breakpoints", async () => {
    jest
      .spyOn(httpClient, "get")
      .mockResolvedValue({ data: { items: [], total: 0, offset: 0, limit: 50 } });
    const result = await fetchPublicDashboardPanels("d1", "tok");
    expect(result.layout).toEqual({ lg: [], md: [], sm: [], xs: [] });
  });

  it("fetchPublicFormSchema reads the public form-schema route with the token", async () => {
    const get = jest.spyOn(httpClient, "get").mockResolvedValue({
      data: { fields: [{ name: "qty", type: "integer", required: true }] },
    });
    const result = await fetchPublicFormSchema("d1", "p1", "tok");
    expect(get).toHaveBeenCalledWith("/api/dashboards/d1/panels/p1/form-schema", {
      params: { token: "tok" },
    });
    expect(result.fields).toEqual([{ name: "qty", type: "integer", required: true }]);
  });
});
