// HEL-1760 -- the shared chart-chunk loader: one import, retried after a failure, and a preload that never rejects.
// The failed-import case is proven at unit level with a mocked module whose first load throws; real-browser retry
// depends on module-map semantics this change does not alter.

let mockAttempts = 0;
jest.mock("../ChartPanel", () => {
  mockAttempts += 1;
  if (mockAttempts === 1) throw new Error("chunk failed");
  return { ChartPanel: () => null };
});

import { loadChartPanel, preloadChartPanel } from "./chartPanelModule";

describe("chartPanelModule", () => {
  it("preload swallows a failed import (no unhandled rejection) and the next load retries and succeeds", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    preloadChartPanel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockAttempts).toBe(1);
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);

    const loaded = await loadChartPanel();
    expect(typeof loaded.ChartPanel).toBe("function");
    expect(mockAttempts).toBe(2);
  });

  it("memoises a fulfilled load: later loads and preloads share the one promise", async () => {
    const first = loadChartPanel();
    preloadChartPanel();
    expect(loadChartPanel()).toBe(first);
    await first;
    expect(mockAttempts).toBe(2);
  });
});
