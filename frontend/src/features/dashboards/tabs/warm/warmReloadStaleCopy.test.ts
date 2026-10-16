// HEL-1575 fix cycle 3: a reload right after an own edit must never restore a browser copy that predates
// the edit. The own write used to be claimed as covering the stored copy (patched into it, or read live by
// a debounced write built from an older list), so the old list validated against the newer change signal
// and was restored with NO request -- the dashboard showed "0 panels" until the next fetch.

import { clearAuth } from "../../../auth/state/authSlice";
import { resetOutputFreshness } from "../../../panels/state/outputFreshness";
import {
  createPanel,
  markDashboardPanelsStale,
  panelsRestored,
} from "../../../panels/state/panelsSlice";
import { dash, makeTabsStore, tab } from "../../../../test/tabsTestStore";
import { outputPanel } from "../../../../test/warmFixtures";
import { snapshotActiveTab } from "../activeTabSnapshot";
import { ACTIVE_SNAPSHOT_DEBOUNCE_MS } from "../activeTabSnapshot";
import { parseInstant } from "../tabTypes";
import { clearWarmState, getWarmStore, setListEntry, setWarmStoreForTests } from "./warmCache";
import { WARM_WRITE_DEBOUNCE_MS } from "./warmConfig";
import { applyWarmEntry } from "./warmRestore";
import { MemoryWarmStore } from "./warmStore";
import { serverNowMs } from "../serverClock";

jest.mock("../dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));

const created = outputPanel("p1", "a", "o1");

function openEmptyDashboard() {
  const harness = makeTabsStore({
    dashboards: [dash("a")],
    tabs: [tab("a", new Date(Date.now() - 1_000).toISOString())],
    activeId: "a",
    selected: "a",
    panels: { items: [], loadedDashboardId: "a" },
  });
  setListEntry("a", { panels: [], contentCapturedAt: serverNowMs() - 5_000 });
  return harness;
}

/** The thunk's real order (`createPanel`): `markDashboardPanelsStale` empties `loadedDashboardId` and is itself an
 *  own-write source, the refetch lands the new list, then `createPanel.fulfilled` records the write again. */
function userCreatesPanel(harness: ReturnType<typeof makeTabsStore>) {
  harness.dispatch(markDashboardPanelsStale("a"));
  harness.dispatch(panelsRestored({ dashboardId: "a", items: [created] }));
  harness.dispatch(createPanel.fulfilled(created, "r", {} as never));
}

/** What a reload would restore for `a`: the stored copy's panels when it validates against the server's
 *  change signal (the dashboard's content last changed with the own write), else null (a cold fetch). */
async function restoredAfterReload(harness: ReturnType<typeof makeTabsStore>) {
  const stored = await getWarmStore().read("user-1", "a");
  if (stored === undefined) return null;
  const state = harness.getState();
  const ownTab = parseInstant(state.dashboardTabs.tabs.find((t) => t.id === "a")?.ownWriteAt);
  const applied = applyWarmEntry({
    dispatch: harness.dispatch,
    entry: stored,
    // The server committed the panel create 1.5 s ago; the pref flush on pagehide carried `ownWriteAt`.
    signal: {
      dashboardId: "a",
      contentUpdatedAt: new Date(serverNowMs() - 1_500).toISOString(),
      dataUpdatedAt: null,
      outputs: [],
    },
    tabOwnWriteAt: ownTab,
  });
  return applied ? stored.panels : null;
}

describe("a reload after an own edit never restores a copy that predates the edit", () => {
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["Date"] });
    await clearWarmState();
    resetOutputFreshness();
    setWarmStoreForTests(new MemoryWarmStore());
  });
  afterEach(() => jest.useRealTimers());

  it("an own write patched into a stored copy of the LOADED dashboard does not make its old list valid", async () => {
    const harness = openEmptyDashboard();
    snapshotActiveTab(harness);
    await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS + 50);
    expect((await getWarmStore().read("user-1", "a"))?.panels).toEqual([]);

    // The create adds the panel to the loaded list (here via the same state `fetchPanels` lands), and the
    // own write is recorded; the page is reloaded before the next snapshot (1.5 s debounce + 0.4 s write).
    userCreatesPanel(harness);
    await jest.advanceTimersByTimeAsync(100);

    const restored = await restoredAfterReload(harness);
    expect(restored === null || restored.length === 1).toBe(true);
  });

  it("a debounced write queued before the edit does not claim the edit for its older list", async () => {
    const harness = openEmptyDashboard();
    snapshotActiveTab(harness); // queues the 400 ms write of the EMPTY list
    userCreatesPanel(harness);
    await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS + 50);

    const restored = await restoredAfterReload(harness);
    expect(restored === null || restored.length === 1).toBe(true);
  });

  it("control: once the post-edit snapshot lands, a reload restores the edited list with no request", async () => {
    const harness = openEmptyDashboard();
    snapshotActiveTab(harness);
    await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS + 50);
    userCreatesPanel(harness);
    await jest.advanceTimersByTimeAsync(ACTIVE_SNAPSHOT_DEBOUNCE_MS + WARM_WRITE_DEBOUNCE_MS + 100);

    expect(await restoredAfterReload(harness)).toEqual([created]);
  });

  it("an own write for a dashboard that is NOT loaded still patches its stored copy (the tab was left)", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a", new Date(Date.now() - 60_000).toISOString()), tab("b")],
      activeId: "b",
      selected: "b",
      panels: { items: [outputPanel("pb", "b", "o1")], loadedDashboardId: "b" },
    });
    await getWarmStore().write({
      v: 1,
      userId: "user-1",
      dashboardId: "a",
      contentCapturedAt: serverNowMs() - 120_000,
      ownWriteAt: null,
      lastViewedAt: serverNowMs() - 60_000,
      panels: [outputPanel("pa", "a", "o1")],
      rows: {},
      outputMeta: {},
      runBaseline: {},
    });
    harness.dispatch(createPanel.fulfilled(outputPanel("pa", "a", "o1"), "r", {} as never));
    await jest.advanceTimersByTimeAsync(50);
    expect((await getWarmStore().read("user-1", "a"))?.ownWriteAt).not.toBeNull();
  });

  it("sign-out still clears (the removal path does not outlive clearAuth)", async () => {
    const harness = openEmptyDashboard();
    harness.dispatch(clearAuth());
    await jest.advanceTimersByTimeAsync(50);
    expect(await getWarmStore().read("user-1", "a")).toBeUndefined();
  });
});
