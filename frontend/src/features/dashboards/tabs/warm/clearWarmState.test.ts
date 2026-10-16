import { configureStore } from "@reduxjs/toolkit";

import { authReducer, logout } from "../../../auth/state/authSlice";
import { isRetained, resetOutputFreshness } from "../../../panels/state/outputFreshness";
import { outputPanel, storedEntry } from "../../../../test/warmFixtures";
import { serverNowMs, setServerOffsetMs, getServerOffsetMs } from "../serverClock";
import { awaitWarmClear } from "./clearWarmHook";
import {
  clearWarmState,
  getListEntry,
  getOwnWriteAt,
  getWarmStore,
  retainTab,
  setListEntry,
  setOwnWriteAt,
  setWarmStoreForTests,
} from "./warmCache";
import { LOGOUT_CLEAR_TIMEOUT_MS, WARM_WRITE_DEBOUNCE_MS } from "./warmConfig";
import { MemoryWarmStore } from "./warmStore";

jest.mock("../../../auth/services/authService", () => ({
  logoutRequest: jest.fn().mockResolvedValue(undefined),
}));

describe("clearWarmState (HEL-1575 task 4.4)", () => {
  beforeEach(async () => {
    setWarmStoreForTests(new MemoryWarmStore()); // a previous test may have left a hung store behind
    await clearWarmState();
    resetOutputFreshness();
  });
  afterEach(() => jest.useRealTimers());

  it("clears the in-memory lists, own writes, retentions and the server clock", async () => {
    const panels = [outputPanel("p1", "d1", "o1")];
    setListEntry("d1", { panels, contentCapturedAt: 1 });
    setOwnWriteAt("d1", 99);
    retainTab("d1", panels);
    setServerOffsetMs(5_000);
    expect(isRetained("o1")).toBe(true);

    await clearWarmState();

    expect(getListEntry("d1")).toBeUndefined();
    expect(getOwnWriteAt("d1")).toBeNull();
    expect(getServerOffsetMs()).toBe(0);
    // released: only the 30 s remount grace remains, which is not a retention by the tab
    expect(serverNowMs()).toBeLessThanOrEqual(Date.now() + 1);
  });

  it("cancels pending debounced writes", async () => {
    jest.useFakeTimers();
    const raw = new MemoryWarmStore();
    setWarmStoreForTests(raw);
    const build = jest.fn(() => storedEntry({ dashboardId: "d1", lastViewedAt: Date.now() }));
    getWarmStore().scheduleWrite("user-1", "d1", build);
    const clearing = clearWarmState();
    await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS * 3);
    await clearing;
    expect(build).not.toHaveBeenCalled();
    expect(await raw.entries()).toEqual([]);
  });

  it("drops a write that was in flight for the previous user (wrong epoch)", async () => {
    const raw = new MemoryWarmStore();
    setWarmStoreForTests(raw);
    const epoch = getWarmStore().epoch;
    await clearWarmState();
    const written = await getWarmStore().write(
      storedEntry({ dashboardId: "d1", userId: "user-1" }),
      epoch,
    );
    expect(written).toBe(false);
    expect(await raw.entries()).toEqual([]);
  });

  it("closes the connection before deleting the database", async () => {
    const order: string[] = [];
    const raw = new MemoryWarmStore();
    jest.spyOn(raw, "close").mockImplementation(() => void order.push("close"));
    jest.spyOn(raw, "destroy").mockImplementation(async () => void order.push("destroy"));
    setWarmStoreForTests(raw);
    await clearWarmState();
    expect(order).toEqual(["close", "destroy"]);
  });

  describe("logout awaits the clear, bounded at 1 s", () => {
    it("awaitWarmClear resolves after the timeout when the database delete hangs", async () => {
      jest.useFakeTimers();
      const raw = new MemoryWarmStore();
      jest.spyOn(raw, "destroy").mockImplementation(() => new Promise(() => undefined));
      setWarmStoreForTests(raw);
      let done = false;
      void awaitWarmClear().then(() => (done = true));
      await jest.advanceTimersByTimeAsync(LOGOUT_CLEAR_TIMEOUT_MS - 10);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(20);
      expect(done).toBe(true);
    });

    it("the logout thunk does not clear auth until the browser copy is gone (or the bound passes)", async () => {
      const raw = new MemoryWarmStore();
      await raw.put("user-1:d1", storedEntry({ dashboardId: "d1" }));
      setWarmStoreForTests(raw);
      const store = configureStore({ reducer: { auth: authReducer } });
      await store.dispatch(logout() as never);
      expect(await raw.entries()).toEqual([]);
      expect(store.getState().auth.status).toBe("unauthenticated");
    });
  });
});
