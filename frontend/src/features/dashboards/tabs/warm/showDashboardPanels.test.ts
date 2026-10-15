import { fetchPanels as fetchPanelsRequest } from "../../../panels/services/panelService";
import { dash, makeTabsStore, tab } from "../../../../test/tabsTestStore";
import { makeOutput, outputPanel, settledWindow, storedEntry } from "../../../../test/warmFixtures";
import {
  currentGeneration,
  isRetained,
  resetOutputFreshness,
} from "../../../panels/state/outputFreshness";
import { paginationHydrated } from "../../../panels/state/panelsSlice";
import { activateTab } from "../dashboardTabsSlice";
import type { DashboardChange, DashboardTab } from "../tabTypes";
import {
  clearWarmState,
  getListEntry,
  getWarmStore,
  retainTab,
  setListEntry,
  setWarmStoreForTests,
} from "./warmCache";
import { LAZY_RESTORE_TIMEOUT_MS, WARM_MAX, WARM_TTL_MS } from "./warmConfig";
import { showDashboardPanels } from "./showDashboardPanels";
import { MemoryWarmStore } from "./warmStore";
import { warmKey } from "./warmStore";
import { captureTab } from "./warmCapture";

jest.mock("../../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));

const fetchPanelsMock = jest.mocked(fetchPanelsRequest);
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const panelsA = [outputPanel("pa1", "a", "o1")];
const panelsB = [outputPanel("pb1", "b", "o9")];

function signal(id: string, over: Partial<DashboardChange> = {}): DashboardChange {
  return {
    dashboardId: id,
    contentUpdatedAt: ago(60 * 60_000),
    dataUpdatedAt: null,
    outputs: [],
    ...over,
  };
}

/** Tab "a" was left `leftAgoMs` ago; "b" is on screen with its panels loaded. */
function scene(
  opts: {
    leftAgoMs?: number;
    otherTabs?: DashboardTab[];
    signalOver?: Partial<DashboardChange>;
  } = {},
) {
  const tabs = [
    tab("a", ago(opts.leftAgoMs ?? 60_000)),
    tab("b", ago(1_000)),
    ...(opts.otherTabs ?? []),
  ];
  const harness = makeTabsStore({
    dashboards: [dash("a"), dash("b"), ...(opts.otherTabs ?? []).map((t) => dash(t.id))],
    tabs,
    activeId: "a",
    selected: "a",
    panels: { items: panelsB, loadedDashboardId: "b" },
    changeSignals: { a: signal("a", opts.signalOver) },
  });
  // "a" was captured 30 min ago as part of leaving it.
  setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() - 30 * 60_000 });
  return harness;
}

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
  setWarmStoreForTests(new MemoryWarmStore());
  fetchPanelsMock.mockReset();
  fetchPanelsMock.mockImplementation(async (id) => (id === "a" ? panelsA : panelsB));
});

describe("showDashboardPanels (HEL-1575 D4)", () => {
  it("a warm tab restores its panel list with NO request", async () => {
    const { dispatch, getState } = scene();
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
    expect(getState().panels.items).toEqual(panelsA);
    expect(getState().panels.loadedDashboardId).toBe("a");
    expect(getState().panels.status).toBe("succeeded");
  });

  it("a restore applies the same resets as fetchPanels.pending (interaction state, cross-filter)", async () => {
    const { dispatch, getState } = scene();
    await dispatch(showDashboardPanels("a"));
    expect(getState().panels.interactionState).toEqual({});
    expect(getState().panels.crossFilter).toBeNull();
  });

  it("after the TTL the tab still exists but refetches on activation", async () => {
    const { dispatch, getState } = scene({ leftAgoMs: WARM_TTL_MS + 5_000 });
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).toHaveBeenCalledWith("a");
    expect(getState().dashboardTabs.tabs.map((t) => t.id)).toContain("a");
  });

  it("after the TTL the tab's held rows are void too: its Outputs are invalidated even inside the remount grace", async () => {
    const { dispatch } = scene({ leftAgoMs: WARM_TTL_MS + 5_000 });
    retainTab("a", panelsA);
    const before = currentGeneration("o1");
    await dispatch(showDashboardPanels("a"));
    expect(currentGeneration("o1")).toBeGreaterThan(before);
  });

  it(`a tab beyond the ${WARM_MAX} most recently used is cold and fetches`, async () => {
    const others = Array.from({ length: WARM_MAX }, (_, i) => tab(`x${i}`, ago(10 + i)));
    const { dispatch } = scene({ otherTabs: others });
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).toHaveBeenCalledWith("a");
  });

  it("a content change since the capture fetches", async () => {
    const { dispatch, getState } = scene({ signalOver: { contentUpdatedAt: ago(1_000) } });
    await dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).toHaveBeenCalledWith("a");
    // the invalid copy was dropped; the list now held is the fresh fetch's, dated at its start
    expect(getListEntry("a")?.contentCapturedAt).toBeGreaterThan(Date.now() - 5_000);
    expect(getState().panels.loadedDashboardId).toBe("a");
  });

  it("the user's own write covers a content time after the capture: still warm", async () => {
    // own write 5 s ago (+ slack) covers the 10 s-old content time
    const own = ago(5_000);
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [{ id: "a", lastViewedAt: ago(60_000), ownWriteAt: own }, tab("b", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: panelsB, loadedDashboardId: "b" },
      changeSignals: { a: signal("a", { contentUpdatedAt: ago(10_000) }) },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() - 30 * 60_000 });
    await harness.dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });

  it("a tab without change signals cannot be validated and fetches", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a", ago(1_000)), tab("b", ago(500))],
      activeId: "a",
      selected: "a",
      panels: { items: panelsB, loadedDashboardId: "b" },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() });
    await harness.dispatch(showDashboardPanels("a"));
    expect(fetchPanelsMock).toHaveBeenCalledWith("a");
  });

  it("never clobbers a list that is already loaded for the dashboard: no restore, no new request", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: [outputPanel("fresh", "a", "o1")], loadedDashboardId: "a" },
      changeSignals: { a: signal("a") },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() });
    await harness.dispatch(showDashboardPanels("a"));
    expect(harness.getState().panels.items.map((p) => p.id)).toEqual(["fresh"]);
    expect(fetchPanelsMock).not.toHaveBeenCalled(); // fetchPanels' own condition: already loaded
  });

  it("never clobbers a list that is loading for the dashboard", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: [], loadedDashboardId: "a", status: "loading" },
      changeSignals: { a: signal("a") },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() });
    await harness.dispatch(showDashboardPanels("a"));
    expect(harness.getState().panels.items).toEqual([]);
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });

  it("invalidates only the row windows whose Output received newer data than the window captured", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: panelsB, loadedDashboardId: "b" },
      changeSignals: {
        a: signal("a", {
          dataUpdatedAt: ago(5_000),
          outputs: [{ outputId: "o1", dataUpdatedAt: ago(5_000) }],
        }),
      },
    });
    const two = [outputPanel("pa1", "a", "o1"), outputPanel("pa2", "a", "o2")];
    setListEntry("a", { panels: two, contentCapturedAt: Date.now() });
    // pa1's window was captured BEFORE the run (stale); pa2's Output has no newer data.
    harness.dispatch(
      paginationHydrated({
        pa1: settledWindow("o1", Date.now() - 20_000),
        pa2: settledWindow("o2", Date.now() - 20_000),
      }),
    );
    const before = { o1: currentGeneration("o1"), o2: currentGeneration("o2") };
    await harness.dispatch(showDashboardPanels("a"));
    expect(currentGeneration("o1")).toBeGreaterThan(before.o1);
    expect(currentGeneration("o2")).toBe(before.o2);
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });

  it("a run observed while the tab was ACTIVE (window captured after the data) leaves it warm", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: panelsB, loadedDashboardId: "b" },
      changeSignals: {
        a: signal("a", {
          dataUpdatedAt: ago(90_000),
          outputs: [{ outputId: "o1", dataUpdatedAt: ago(90_000) }],
        }),
      },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() });
    // The page-0 refresh after the run started AFTER the run's data time.
    harness.dispatch(paginationHydrated({ pa1: settledWindow("o1", Date.now() - 80_000) }));
    const before = currentGeneration("o1");
    await harness.dispatch(showDashboardPanels("a"));
    expect(currentGeneration("o1")).toBe(before);
    expect(fetchPanelsMock).not.toHaveBeenCalled();
  });

  describe("lazy restore of a warm tab that is not in memory (first activation after a reload)", () => {
    function lazyScene() {
      const harness = makeTabsStore({
        dashboards: [dash("a"), dash("b")],
        tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
        activeId: "a",
        selected: "a",
        panels: { items: panelsB, loadedDashboardId: "b" },
        changeSignals: { a: signal("a") },
        user: undefined,
      });
      return harness;
    }

    it("restores from the browser store with no request, showing the skeleton flag while it reads", async () => {
      const harness = lazyScene();
      const slow = new MemoryWarmStore();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const get = slow.get.bind(slow);
      jest.spyOn(slow, "get").mockImplementation(async (k) => {
        await gate;
        return get(k);
      });
      setWarmStoreForTests(slow);
      await slow.put(
        warmKey("user-1", "a"),
        storedEntry({
          dashboardId: "a",
          contentCapturedAt: Date.now(),
          panels: panelsA,
          outputMeta: { o1: makeOutput("o1") },
        }),
      );
      const showing = harness.dispatch(showDashboardPanels("a"));
      await Promise.resolve();
      // While the read is pending the panel area must show its skeleton, not a blank frame.
      expect(harness.getState().panels.restoringDashboardId).toBe("a");
      expect(harness.getState().panels.status).toBe("succeeded");
      release();
      await showing;
      expect(harness.getState().panels.restoringDashboardId).toBeNull();
      expect(harness.getState().panels.items).toEqual(panelsA);
      expect(fetchPanelsMock).not.toHaveBeenCalled();
    });

    it(`gives up after ${LAZY_RESTORE_TIMEOUT_MS} ms and fetches`, async () => {
      jest.useFakeTimers();
      try {
        const harness = lazyScene();
        const slow = new MemoryWarmStore();
        jest.spyOn(slow, "get").mockImplementation(() => new Promise(() => undefined));
        setWarmStoreForTests(slow);
        const showing = harness.dispatch(showDashboardPanels("a"));
        await jest.advanceTimersByTimeAsync(LAZY_RESTORE_TIMEOUT_MS + 1);
        await showing;
        expect(fetchPanelsMock).toHaveBeenCalledWith("a");
        expect(harness.getState().panels.restoringDashboardId).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it("an invalid stored copy (content changed) is deleted and the tab fetches", async () => {
      const harness = lazyScene();
      const store = new MemoryWarmStore();
      setWarmStoreForTests(store);
      await store.put(
        warmKey("user-1", "a"),
        storedEntry({
          dashboardId: "a",
          contentCapturedAt: Date.now() - 2 * 60 * 60_000,
          panels: panelsA,
        }),
      );
      await harness.dispatch(showDashboardPanels("a"));
      expect(fetchPanelsMock).toHaveBeenCalledWith("a");
      await new Promise((r) => setTimeout(r, 0));
      expect(await store.get(warmKey("user-1", "a"))).toBeUndefined();
    });

    it("abandons the restore when the selection moved on during the read (no clobber, no stale restore)", async () => {
      const harness = lazyScene();
      const store = new MemoryWarmStore();
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const get = store.get.bind(store);
      jest.spyOn(store, "get").mockImplementation(async (k) => {
        await gate;
        return get(k);
      });
      setWarmStoreForTests(store);
      await store.put(
        warmKey("user-1", "a"),
        storedEntry({ dashboardId: "a", contentCapturedAt: Date.now(), panels: panelsA }),
      );
      const showing = harness.dispatch(showDashboardPanels("a"));
      await Promise.resolve();
      harness.dispatch(activateTab("b")); // the user moved on
      release();
      await showing;
      expect(harness.getState().panels.items).toEqual(panelsB);
      expect(harness.getState().panels.restoringDashboardId).toBeNull();
      expect(fetchPanelsMock).not.toHaveBeenCalledWith("a");
    });
  });
});

describe("leaving a tab captures it (HEL-1575 D4/D5)", () => {
  it("activating another tab captures the left tab: warm on return, retained, and written to the browser store", async () => {
    jest.useFakeTimers({ doNotFake: ["Date", "nextTick", "queueMicrotask"] });
    try {
      const harness = makeTabsStore({
        dashboards: [dash("a"), dash("b")],
        tabs: [tab("a", ago(1_000)), tab("b", ago(1_000))],
        activeId: "a",
        selected: "a",
        panels: { items: panelsA, loadedDashboardId: "a" },
        changeSignals: { a: signal("a"), b: signal("b") },
      });
      setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() - 60_000 });
      harness.dispatch(activateTab("b")); // the listener captures "a" before anything replaces the panels
      expect(isRetained("o1")).toBe(true);
      await jest.advanceTimersByTimeAsync(1_000);
      const stored = await getWarmStore().read("user-1", "a");
      expect(stored?.panels).toEqual(panelsA);
      expect(stored?.dashboardId).toBe("a");
    } finally {
      jest.useRealTimers();
    }
  });

  it("the active tab's hidden/pagehide snapshot writes immediately and takes no retention", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a")],
      tabs: [tab("a", ago(1_000))],
      activeId: "a",
      selected: "a",
      panels: { items: panelsA, loadedDashboardId: "a" },
      changeSignals: { a: signal("a") },
    });
    setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() - 60_000 });
    captureTab(harness.getState, "a", { retain: false, immediate: true });
    await new Promise((r) => setTimeout(r, 0));
    expect((await getWarmStore().read("user-1", "a"))?.panels).toEqual(panelsA);
    expect(isRetained("o1")).toBe(false);
  });

  it("does not capture a tab whose panels are not the loaded list", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
      panels: { items: panelsB, loadedDashboardId: "b" },
    });
    captureTab(harness.getState, "a", { retain: true, immediate: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(await getWarmStore().read("user-1", "a")).toBeUndefined();
  });
});
