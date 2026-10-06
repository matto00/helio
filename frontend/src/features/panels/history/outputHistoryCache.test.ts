import { makeHistory } from "./historyFixtures";
import {
  HISTORY_RETRY_DELAY_MS,
  getCachedHistory,
  loadHistory,
  refreshHistory,
  resetHistoryCache,
} from "./outputHistoryCache";

beforeEach(() => {
  jest.useFakeTimers();
  resetHistoryCache();
});
afterEach(() => jest.useRealTimers());

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("outputHistoryCache", () => {
  it("shares one in-flight request between two consumers", async () => {
    const fetcher = jest.fn().mockResolvedValue(makeHistory());
    const a = loadHistory("output:1", fetcher);
    const b = loadHistory("output:1", fetcher);
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getCachedHistory("output:1")).toBeDefined();
  });

  it("evicts a rejected load so a later mount can retry", async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(makeHistory());
    await expect(loadHistory("output:1", fetcher)).rejects.toThrow("x");
    await loadHistory("output:1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refetches on a terminal run and keeps the stale value meanwhile", async () => {
    const old = makeHistory();
    const fresh = makeHistory({
      current: { capturedAt: "2026-10-06T10:00:00Z", rowCount: 1, value: 1 },
    });
    await loadHistory("output:1", () => Promise.resolve(old));
    const fetcher = jest.fn().mockResolvedValue(fresh);
    refreshHistory("output:1", fetcher);
    expect(getCachedHistory("output:1")).toBe(old);
    await flush();
    expect(getCachedHistory("output:1")).toBe(fresh);
    jest.advanceTimersByTime(HISTORY_RETRY_DELAY_MS * 2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when the head did not advance", async () => {
    await loadHistory("output:1", () => Promise.resolve(makeHistory()));
    const fetcher = jest.fn().mockResolvedValue(makeHistory());
    refreshHistory("output:1", fetcher);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(HISTORY_RETRY_DELAY_MS);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(HISTORY_RETRY_DELAY_MS * 3);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
