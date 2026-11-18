import { httpClient } from "../../../services/httpClient";
import { makeOutput } from "../../../test/remountFixtures";
import { preloadChartPanel } from "../ui/renderers/chartPanelModule";
import { fetchOutputMeta, seedOutputMeta } from "./outputMetaCache";

// HEL-1760 -- a resolved or restored chart-kind Output starts loading the chart code; other kinds never do.
jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../ui/renderers/chartPanelModule", () => ({ preloadChartPanel: jest.fn() }));

const http = jest.mocked(httpClient);
const preload = jest.mocked(preloadChartPanel);

beforeEach(() => jest.clearAllMocks());

describe("outputMetaCache chart preload", () => {
  it("preloads when a fetched Output is a chart, once the response arrives", async () => {
    http.get.mockResolvedValue({ data: makeOutput("c1", "chart", {}) });
    const pending = fetchOutputMeta("c1");
    expect(preload).not.toHaveBeenCalled();
    await pending;
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it.each(["table", "metric", "markdown"])("does not preload for a %s Output", async (kind) => {
    http.get.mockResolvedValue({ data: makeOutput(`o-${kind}`, kind, {}) });
    await fetchOutputMeta(`o-${kind}`);
    expect(preload).not.toHaveBeenCalled();
  });

  it("preloads when a chart's metadata is seeded from the warm cache, and not for other kinds", () => {
    seedOutputMeta("c2", makeOutput("c2", "chart", {}));
    expect(preload).toHaveBeenCalledTimes(1);
    seedOutputMeta("t2", makeOutput("t2", "table", {}));
    expect(preload).toHaveBeenCalledTimes(1);
  });
});
