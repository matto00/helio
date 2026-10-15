import { patchDashboardTabsRequest } from "../../auth/services/authService";
import {
  cancelTabsWrite,
  flushTabsWrite,
  scheduleTabsWrite,
  TABS_WRITE_DEBOUNCE_MS,
  toTabsWire,
} from "./tabsPersistence";
import { makeTabsStore, dash, tab } from "../../../test/tabsTestStore";
import { openTabInBackground, tabViewed } from "./dashboardTabsSlice";
import { handlePageHidden } from "./tabsBrowserTriggers";

jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("./dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));

const patchMock = jest.mocked(patchDashboardTabsRequest);
const wire = (ids: string[]) =>
  toTabsWire(
    ids.map((id) => tab(id)),
    ids[0] ?? null,
  );

describe("tab set persistence (design D2)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    patchMock.mockReset();
    patchMock.mockResolvedValue(undefined);
    cancelTabsWrite();
  });
  afterEach(() => {
    cancelTabsWrite();
    jest.useRealTimers();
  });

  it("coalesces a burst of changes into ONE PATCH carrying the latest value", async () => {
    scheduleTabsWrite(wire(["a"]));
    scheduleTabsWrite(wire(["a", "b"]));
    scheduleTabsWrite(wire(["a", "b", "c"]));
    expect(patchMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(TABS_WRITE_DEBOUNCE_MS + 1);
    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(
      (patchMock.mock.calls[0][0] as { tabs: { id: string }[] }).tabs.map((t) => t.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("waits the full 1000 ms trailing window after the last change", async () => {
    scheduleTabsWrite(wire(["a"]));
    await jest.advanceTimersByTimeAsync(900);
    scheduleTabsWrite(wire(["a", "b"]));
    await jest.advanceTimersByTimeAsync(900);
    expect(patchMock).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  it("a failed write is swallowed and keeps nothing queued (local state is untouched)", async () => {
    patchMock.mockRejectedValueOnce(new Error("offline"));
    scheduleTabsWrite(wire(["a"]));
    await expect(jest.advanceTimersByTimeAsync(TABS_WRITE_DEBOUNCE_MS + 1)).resolves.not.toThrow();
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  it("omits ownWriteAt when never set and carries it when set", () => {
    const body = toTabsWire(
      [
        { id: "a", lastViewedAt: null, ownWriteAt: null },
        {
          id: "b",
          lastViewedAt: "2026-01-01T00:00:00.000Z",
          ownWriteAt: "2026-01-01T00:00:05.000Z",
        },
      ],
      "a",
    );
    expect(body.tabs[0]).toEqual({ id: "a", lastViewedAt: null });
    expect(body.tabs[1]).toEqual({
      id: "b",
      lastViewedAt: "2026-01-01T00:00:00.000Z",
      ownWriteAt: "2026-01-01T00:00:05.000Z",
    });
  });

  it("cancelTabsWrite drops a queued write (sign-out never writes the previous user's tabs)", async () => {
    scheduleTabsWrite(wire(["a"]));
    cancelTabsWrite();
    await jest.advanceTimersByTimeAsync(TABS_WRITE_DEBOUNCE_MS * 2);
    expect(patchMock).not.toHaveBeenCalled();
  });

  describe("keepalive flush on hidden/pagehide", () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    beforeEach(() => {
      fetchMock.mockClear();
      global.fetch = fetchMock as never;
    });

    it("flushKeepalive sends the pending write through fetch with keepalive, credentials and the CSRF header", async () => {
      scheduleTabsWrite(wire(["a", "b"]));
      await flushTabsWrite({ keepalive: true });
      expect(patchMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/users/me/preferences");
      expect(init).toMatchObject({ method: "PATCH", keepalive: true, credentials: "include" });
      expect(init.headers["X-Helio-Requested-With"]).toBe("1");
      expect(JSON.parse(init.body).dashboardTabs.tabs.map((t: { id: string }) => t.id)).toEqual([
        "a",
        "b",
      ]);
      // The flush consumed the queue: the debounce timer must not send it a second time.
      await jest.advanceTimersByTimeAsync(TABS_WRITE_DEBOUNCE_MS * 2);
      expect(patchMock).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("hidden/pagehide stamps the active tab's last view, then flushes with keepalive", async () => {
      const { store, getState } = makeTabsStore({
        dashboards: [dash("a"), dash("b")],
        tabs: [tab("a"), tab("b")],
        activeId: "a",
        selected: "a",
      });
      store.dispatch(openTabInBackground("zzz")); // a queued change, as a real session would have
      handlePageHidden({ dispatch: store.dispatch as never, getState });
      await Promise.resolve();
      expect(getState().dashboardTabs.tabs[0].lastViewedAt).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body).dashboardTabs;
      expect(body.tabs[0].lastViewedAt).not.toBeNull();
    });

    it("does nothing before the tab set is hydrated", async () => {
      const { store, getState } = makeTabsStore({ hydrated: false, dashboardsStatus: "idle" });
      handlePageHidden({ dispatch: store.dispatch as never, getState });
      expect(fetchMock).not.toHaveBeenCalled();
      store.dispatch(tabViewed({ id: "x", at: "2026-01-01T00:00:00.000Z" }));
    });
  });
});
