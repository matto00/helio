import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { outputPanel, settledWindow } from "../../../test/warmFixtures";
import { resetOutputFreshness } from "../../panels/state/outputFreshness";
import { paginationHydrated } from "../../panels/state/panelsSlice";
import {
  ACTIVE_HEARTBEAT_INTERVAL_MS,
  ACTIVE_SNAPSHOT_DEBOUNCE_MS,
  snapshotActiveTab,
} from "./activeTabSnapshot";
import { startTabsBrowserTriggers } from "./tabsBrowserTriggers";
import { TABS_WRITE_DEBOUNCE_MS } from "./tabsPersistence";
import { clearWarmState, getWarmStore, setListEntry } from "./warm/warmCache";
import { WARM_WRITE_DEBOUNCE_MS } from "./warm/warmConfig";
import { patchDashboardTabsRequest } from "../../auth/services/authService";

jest.mock("./dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));

const patchMock = jest.mocked(patchDashboardTabsRequest);
const panelsA = [outputPanel("pa1", "a", "o1")];
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function activeA(lastViewedAt: string | null) {
  const harness = makeTabsStore({
    dashboards: [dash("a")],
    tabs: [tab("a", lastViewedAt)],
    activeId: "a",
    selected: "a",
    panels: { items: panelsA, loadedDashboardId: "a" },
  });
  setListEntry("a", { panels: panelsA, contentCapturedAt: Date.now() - 60_000 });
  return harness;
}

describe("the active tab is snapshotted while open (HEL-1575 C1, final-gate r1)", () => {
  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["Date"] });
    patchMock.mockClear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as never;
    await clearWarmState();
    resetOutputFreshness();
  });
  afterEach(() => jest.useRealTimers());

  it("writes the browser copy once the row windows settle, with no pagehide and no tab switch", async () => {
    const harness = activeA(ago(1_000));
    harness.dispatch(paginationHydrated({ pa1: settledWindow("o1", Date.now() - 1_000) }));

    await jest.advanceTimersByTimeAsync(ACTIVE_SNAPSHOT_DEBOUNCE_MS - 10);
    expect(await getWarmStore().read("user-1", "a")).toBeUndefined();
    await jest.advanceTimersByTimeAsync(10 + WARM_WRITE_DEBOUNCE_MS + 50);

    const stored = await getWarmStore().read("user-1", "a");
    expect(stored?.panels).toEqual(panelsA);
    expect(Object.keys(stored?.rows ?? {})).toEqual(["pa1"]);
  });

  it("does nothing for an active tab whose panels are not the loaded list", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
      panels: { items: [outputPanel("pb1", "b", "o9")], loadedDashboardId: "b" },
    });
    snapshotActiveTab(harness);
    await jest.advanceTimersByTimeAsync(ACTIVE_SNAPSHOT_DEBOUNCE_MS + WARM_WRITE_DEBOUNCE_MS + 50);
    expect(await getWarmStore().read("user-1", "a")).toBeUndefined();
  });

  it("stamps only the browser copy: the tab set in the store is untouched and nothing is PATCHed", async () => {
    const harness = activeA(null);
    const before = harness.getState().dashboardTabs;
    snapshotActiveTab(harness);
    await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS + TABS_WRITE_DEBOUNCE_MS + 50);
    const after = harness.getState().dashboardTabs;
    expect(after.tabs).toBe(before.tabs); // same reference: no tabViewed, no signal, no ownWriteAt
    expect(after.changeSignals).toBe(before.changeSignals);
    expect(after.activeId).toBe("a");
    expect(patchMock).not.toHaveBeenCalled();
    const stored = await getWarmStore().read("user-1", "a");
    expect(stored?.lastViewedAt).toBeGreaterThan(Date.now() - 5_000);
  });

  it("final-gate r2: an idle, visible active tab sends 0 preferences PATCHes over 2x the heartbeat, while its browser copy's lastViewedAt advances", async () => {
    let clock = Date.now();
    jest.spyOn(Date, "now").mockImplementation(() => clock);
    const harness = activeA(new Date(clock - 1_000).toISOString());
    const stop = startTabsBrowserTriggers(harness);
    try {
      const seen: number[] = [];
      for (let beat = 0; beat < 2; beat++) {
        for (let i = 0; i < 6; i++) {
          clock += 10_000;
          await jest.advanceTimersByTimeAsync(10_000);
        }
        await jest.advanceTimersByTimeAsync(WARM_WRITE_DEBOUNCE_MS + TABS_WRITE_DEBOUNCE_MS + 50);
        seen.push((await getWarmStore().read("user-1", "a"))?.lastViewedAt ?? 0);
      }
      expect(ACTIVE_HEARTBEAT_INTERVAL_MS * 2).toBe(120_000);
      expect(seen[0]).toBeGreaterThan(clock - 3 * ACTIVE_HEARTBEAT_INTERVAL_MS);
      expect(seen[1]).toBeGreaterThan(seen[0]);
      expect(patchMock).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      stop();
      jest.restoreAllMocks();
    }
  });
});
