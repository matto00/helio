// HEL-1760 -- a public / share-token viewer's chart-kind Output metadata starts loading the chart code.
import { httpClient } from "../../../services/httpClient";
import { preloadChartPanel } from "../../panels/ui/renderers/chartPanelModule";
import { fetchPublicOutputMeta } from "./publicDashboardService";

jest.mock("../../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));
jest.mock("../../panels/ui/renderers/chartPanelModule", () => ({ preloadChartPanel: jest.fn() }));

const get = jest.mocked(httpClient.get);
const preload = jest.mocked(preloadChartPanel);

beforeEach(() => jest.clearAllMocks());

describe("fetchPublicOutputMeta chart preload", () => {
  it("preloads for a chart Output", async () => {
    get.mockResolvedValueOnce({ data: { kind: "chart", config: {}, schema: [] } });
    await fetchPublicOutputMeta("d1", "p1", "tok");
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it.each(["table", "metric", "markdown"])("does not preload for a %s Output", async (kind) => {
    get.mockResolvedValueOnce({ data: { kind, config: {}, schema: [] } });
    await fetchPublicOutputMeta("d1", "p1", "tok");
    expect(preload).not.toHaveBeenCalled();
  });
});
