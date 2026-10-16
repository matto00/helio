import { configureStore } from "@reduxjs/toolkit";

import { clearAuth } from "../../auth/state/authSlice";
import { resetServerClock, serverNowMs } from "../../dashboards/tabs/serverClock";
import { summary } from "../test/homeFixtures";
import { homeSummaryReducer, loadHomeSummary } from "./homeSummarySlice";

jest.mock("../services/homeService");
import { fetchHomeSummary } from "../services/homeService";

const fetchMock = fetchHomeSummary as jest.MockedFunction<typeof fetchHomeSummary>;

function makeStore() {
  return configureStore({ reducer: { homeSummary: homeSummaryReducer } });
}

describe("homeSummarySlice", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    resetServerClock();
  });

  it("starts idle, shows loading on the first load, then holds the data", async () => {
    fetchMock.mockResolvedValue(summary());
    const store = makeStore();
    expect(store.getState().homeSummary.status).toBe("idle");
    const pending = store.dispatch(loadHomeSummary());
    expect(store.getState().homeSummary.status).toBe("loading");
    await pending;
    expect(store.getState().homeSummary.status).toBe("succeeded");
    expect(store.getState().homeSummary.data).toEqual(summary());
  });

  it("keeps the last good data (and status) through a refetch and a failed refetch", async () => {
    fetchMock.mockResolvedValueOnce(summary({ pipelinesWithActivity: 2 }));
    const store = makeStore();
    await store.dispatch(loadHomeSummary());
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    const refetch = store.dispatch(loadHomeSummary());
    expect(store.getState().homeSummary.status).toBe("succeeded");
    await refetch;
    expect(store.getState().homeSummary.status).toBe("succeeded");
    expect(store.getState().homeSummary.data?.pipelinesWithActivity).toBe(2);
    expect(store.getState().homeSummary.error).not.toBeNull();
  });

  it("reports failure when the first load fails", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const store = makeStore();
    await store.dispatch(loadHomeSummary());
    expect(store.getState().homeSummary.status).toBe("failed");
    expect(store.getState().homeSummary.data).toBeNull();
  });

  it("skips a second dispatch while one is in flight (StrictMode's double effect)", async () => {
    fetchMock.mockResolvedValue(summary());
    const store = makeStore();
    const first = store.dispatch(loadHomeSummary());
    const second = store.dispatch(loadHomeSummary());
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await store.dispatch(loadHomeSummary());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("queues one trailing refetch when a queueIfBusy dispatch is skipped, and a plain skipped dispatch queues nothing", async () => {
    fetchMock.mockResolvedValue(summary());
    const store = makeStore();
    const first = store.dispatch(loadHomeSummary());
    await store.dispatch(loadHomeSummary());
    expect(store.getState().homeSummary.refetchQueued).toBe(false);
    await store.dispatch(loadHomeSummary({ queueIfBusy: true }));
    expect(store.getState().homeSummary.refetchQueued).toBe(true);
    await first;
    expect(store.getState().homeSummary.inFlight).toBe(false);
    expect(store.getState().homeSummary.refetchQueued).toBe(true);
    // The page's effect then runs the trailing request, whose start clears the flag.
    await store.dispatch(loadHomeSummary());
    expect(store.getState().homeSummary.refetchQueued).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("measures the server clock offset from serverNow", async () => {
    const skew = 90_000;
    fetchMock.mockResolvedValue(summary({ serverNow: new Date(Date.now() + skew).toISOString() }));
    await makeStore().dispatch(loadHomeSummary());
    expect(serverNowMs() - Date.now()).toBeGreaterThan(skew - 2_000);
    expect(serverNowMs() - Date.now()).toBeLessThan(skew + 2_000);
  });

  it("clears on sign-out", async () => {
    fetchMock.mockResolvedValue(summary());
    const store = configureStore({ reducer: { homeSummary: homeSummaryReducer } });
    await store.dispatch(loadHomeSummary());
    store.dispatch(clearAuth());
    expect(store.getState().homeSummary.data).toBeNull();
    expect(store.getState().homeSummary.status).toBe("idle");
  });
});

describe("loadHomeSummary dashboardIds (Phase B)", () => {
  it("asks for the viewed dashboards' change times, newest view first, at most 20", async () => {
    const { dashboardSeenStore } = await import("../../commandPalette/model/dashboardSeenStore");
    for (let i = 0; i < 25; i += 1) dashboardSeenStore.recordViewed(`ids-${i}`, 1_000 + i);
    dashboardSeenStore.recordOwnWrite("ids-own-only", 9_999);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(summary());
    await configureStore({ reducer: { homeSummary: homeSummaryReducer } }).dispatch(
      loadHomeSummary(),
    );
    const asked = fetchMock.mock.calls[0][0] as string[];
    expect(asked).toHaveLength(20);
    expect(asked[0]).toBe("ids-24");
    expect(asked).not.toContain("ids-own-only");
    expect(asked).not.toContain("ids-4");
  });
});
