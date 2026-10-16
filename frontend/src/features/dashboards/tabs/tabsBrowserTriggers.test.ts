import { fetchDashboardChanges } from "./dashboardChangesService";
import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { outputPanel } from "../../../test/warmFixtures";
import { isRetained, resetOutputFreshness } from "../../panels/state/outputFreshness";
import { closeTab, openTabInBackground, tabViewed } from "./dashboardTabsSlice";
import {
  LEAVE_STAMP_REFRESH_MS,
  SIGNALS_REFRESH_INTERVAL_MS,
  SIGNALS_VISIBLE_MIN_GAP_MS,
  startTabsBrowserTriggers,
} from "./tabsBrowserTriggers";
import { TABS_WRITE_DEBOUNCE_MS } from "./tabsPersistence";
import {
  clearWarmState,
  getListEntry,
  getWarmStore,
  retainTab,
  setListEntry,
} from "./warm/warmCache";
import { captureTab } from "./warm/warmCapture";
import { WARM_SWEEP_INTERVAL_MS, WARM_TTL_MS } from "./warm/warmConfig";

jest.mock("./dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));

const changesMock = jest.mocked(fetchDashboardChanges);

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("tabs browser triggers (HEL-1575 D2/D4/D7)", () => {
  let stop: () => void = () => undefined;
  beforeEach(async () => {
    window.history.pushState({}, "", "/home");
    jest.useFakeTimers({ doNotFake: ["Date"] });
    changesMock.mockReset();
    changesMock.mockResolvedValue({ serverNow: new Date().toISOString(), items: [] });
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
    await clearWarmState();
    resetOutputFreshness();
  });
  afterEach(() => {
    stop();
    setVisibility("visible");
    jest.useRealTimers();
  });

  function start() {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    stop = startTabsBrowserTriggers({
      dispatch: harness.store.dispatch as never,
      getState: harness.getState,
    });
    return harness;
  }

  it("refreshes the change signals when the page becomes visible", async () => {
    start();
    setVisibility("visible");
    await jest.advanceTimersByTimeAsync(0);
    expect(changesMock).toHaveBeenCalledTimes(1);
    expect(changesMock).toHaveBeenCalledWith(["a", "b"]);
  });

  it("refreshes every 2 minutes while visible, and not while hidden", async () => {
    start();
    await jest.advanceTimersByTimeAsync(SIGNALS_REFRESH_INTERVAL_MS + 1);
    expect(changesMock).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    changesMock.mockClear();
    await jest.advanceTimersByTimeAsync(SIGNALS_REFRESH_INTERVAL_MS * 2);
    expect(changesMock).not.toHaveBeenCalled();
  });

  it("hidden stamps the active tab's last view and flushes the tab write with keepalive", async () => {
    const { getState } = start();
    setVisibility("hidden");
    await jest.advanceTimersByTimeAsync(0);
    expect(getState().dashboardTabs.tabs[0].lastViewedAt).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({ keepalive: true });
  });

  it("pagehide does the same", async () => {
    const { getState } = start();
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(0);
    expect(getState().dashboardTabs.tabs[0].lastViewedAt).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("one leave (hidden followed by pagehide) sends at most one PATCH", async () => {
    // A real browser's two events are a few ms apart, so a second stamp would differ from the first.
    let now = Date.now();
    const clock = jest.spyOn(Date, "now").mockImplementation(() => (now += 3));
    start();
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(TABS_WRITE_DEBOUNCE_MS + 10);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it("a second leave after the page was shown again is a new leave", async () => {
    const { dispatch } = start();
    setVisibility("hidden");
    await jest.advanceTimersByTimeAsync(0);
    setVisibility("visible");
    dispatch(
      tabViewed({
        id: "a",
        at: new Date(Date.now() - LEAVE_STAMP_REFRESH_MS - 1000).toISOString(),
      }),
    );
    await jest.advanceTimersByTimeAsync(0);
    (global.fetch as jest.Mock).mockClear();
    setVisibility("hidden");
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("HEL-1575 C1: a leave capture never rewinds the browser copy's lastViewedAt below the fresher heartbeat stamp", async () => {
    const panels = [outputPanel("pa1", "a", "o1")];
    const harness = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a", new Date(Date.now() - 4 * 60_000).toISOString())],
      activeId: "a",
      selected: "a",
      panels: { items: panels, loadedDashboardId: "a" },
    });
    setListEntry("a", { panels, contentCapturedAt: Date.now() - 60_000 });
    stop = startTabsBrowserTriggers({
      dispatch: harness.store.dispatch as never,
      getState: harness.getState,
    });
    // The 60s heartbeat wrote a local-only stamp of 30s ago; the stored (server) stamp is 4 min old.
    captureTab(harness.getState, "a", {
      retain: false,
      immediate: true,
      viewedAt: Date.now() - 30_000,
    });
    await jest.advanceTimersByTimeAsync(0);
    const before = Date.now();
    setVisibility("hidden");
    await jest.advanceTimersByTimeAsync(0);
    const stored = await getWarmStore().read("user-1", "a");
    expect(stored?.lastViewedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(global.fetch).not.toHaveBeenCalled(); // the stored stamp is < 5 min old: no PATCH
  });

  it("a pending real change plus hidden plus pagehide sends exactly one PATCH (the leave dedupe)", async () => {
    const { dispatch } = start();
    dispatch(closeTab("b"));
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(TABS_WRITE_DEBOUNCE_MS + 10);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sends nothing off the dashboard view", async () => {
    window.history.pushState({}, "", "/sources");
    const { getState } = start();
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getState().dashboardTabs.tabs[0].lastViewedAt).toBeNull();
  });

  it("still flushes a pending real tab change off the dashboard view, once", async () => {
    window.history.pushState({}, "", "/sources");
    const { dispatch } = start();
    dispatch(closeTab("b"));
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((global.fetch as jest.Mock).mock.calls[0][1]).toMatchObject({ keepalive: true });
  });

  it("skips the PATCH when only the re-stamp of a recently stamped tab would change", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a", new Date(Date.now() - 60_000).toISOString())],
      activeId: "a",
      selected: "a",
    });
    stop = startTabsBrowserTriggers({
      dispatch: harness.store.dispatch as never,
      getState: harness.getState,
    });
    setVisibility("hidden");
    window.dispatchEvent(new Event("pagehide"));
    await jest.advanceTimersByTimeAsync(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("a visible burst refreshes the signals once per gap, and never off the dashboard view", async () => {
    const realNow = Date.now.bind(Date);
    const clock = jest.spyOn(Date, "now");
    start();
    setVisibility("visible");
    setVisibility("visible");
    await jest.advanceTimersByTimeAsync(0);
    expect(changesMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(SIGNALS_VISIBLE_MIN_GAP_MS + 1);
    clock.mockImplementation(() => realNow() + SIGNALS_VISIBLE_MIN_GAP_MS + 1);
    setVisibility("visible");
    await jest.advanceTimersByTimeAsync(0);
    expect(changesMock).toHaveBeenCalledTimes(2);
    window.history.pushState({}, "", "/pipelines");
    await jest.advanceTimersByTimeAsync(SIGNALS_REFRESH_INTERVAL_MS * 2);
    setVisibility("visible");
    expect(changesMock).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it("the stop function removes the listeners and timers", async () => {
    start();
    stop();
    setVisibility("visible");
    await jest.advanceTimersByTimeAsync(SIGNALS_REFRESH_INTERVAL_MS * 2);
    expect(changesMock).not.toHaveBeenCalled();
  });

  describe("retention sweep", () => {
    const panels = [outputPanel("p1", "b", "o1")];

    it("a tab left within the TTL keeps its retention; after the TTL the minute sweep releases it", async () => {
      const harness = makeTabsStore({
        dashboards: [dash("a"), dash("b")],
        tabs: [
          tab("a"),
          { id: "b", lastViewedAt: new Date(Date.now() - 60_000).toISOString(), ownWriteAt: null },
        ],
        activeId: "a",
        selected: "a",
      });
      stop = startTabsBrowserTriggers({
        dispatch: harness.store.dispatch as never,
        getState: harness.getState,
      });
      setListEntry("b", { panels, contentCapturedAt: 1 });
      retainTab("b", panels);
      await jest.advanceTimersByTimeAsync(WARM_SWEEP_INTERVAL_MS + 1);
      expect(isRetained("o1")).toBe(true);
      // Move the tab's last view beyond the TTL.
      harness.dispatch({
        type: "dashboardTabs/tabViewed",
        payload: { id: "b", at: new Date(Date.now() - WARM_TTL_MS - 5_000).toISOString() },
      });
      await jest.advanceTimersByTimeAsync(WARM_SWEEP_INTERVAL_MS + 1);
      expect(getListEntry("b")).toBeUndefined();
    });

    it("closing a tab releases its retention and list at once (not a minute later)", () => {
      const harness = makeTabsStore({
        dashboards: [dash("a"), dash("b")],
        tabs: [tab("a"), { id: "b", lastViewedAt: new Date().toISOString(), ownWriteAt: null }],
        activeId: "a",
        selected: "a",
      });
      setListEntry("b", { panels, contentCapturedAt: 1 });
      retainTab("b", panels);
      expect(isRetained("o1")).toBe(true);
      harness.dispatch(closeTab("b"));
      expect(getListEntry("b")).toBeUndefined();
      // released: nothing holds the tab-level retention any more (only the 30 s grace remains)
      harness.dispatch(openTabInBackground("zzz"));
      expect(getListEntry("b")).toBeUndefined();
    });
  });
});
