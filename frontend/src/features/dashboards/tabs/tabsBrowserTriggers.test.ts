import { fetchDashboardChanges } from "./dashboardChangesService";
import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { outputPanel } from "../../../test/warmFixtures";
import { isRetained, resetOutputFreshness } from "../../panels/state/outputFreshness";
import { closeTab, openTabInBackground } from "./dashboardTabsSlice";
import { SIGNALS_REFRESH_INTERVAL_MS, startTabsBrowserTriggers } from "./tabsBrowserTriggers";
import { clearWarmState, retainTab, setListEntry, getListEntry } from "./warm/warmCache";
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
