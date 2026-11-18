import { dash, makeTabsStore, testUser } from "../../../test/tabsTestStore";
import { outputPanel, storedEntry } from "../../../test/warmFixtures";
import { fetchDashboardChanges } from "./dashboardChangesService";
import { deepLinkDashboardId, hydrateTabs, planHydration } from "./hydrateTabs";
import { clearWarmState, getListEntry, getWarmStore } from "./warm/warmCache";
import { normalizeSavedTabs } from "./tabTypes";

jest.mock("./dashboardChangesService", () => ({ fetchDashboardChanges: jest.fn() }));
jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../panels/services/panelService", () => ({ fetchPanels: jest.fn() }));

const changesMock = jest.mocked(fetchDashboardChanges);
const ids = (...x: string[]) => new Set(x);
const saved = (
  tabs: Array<{ id: string; lastViewedAt?: string | null }>,
  activeId?: string | null,
) => normalizeSavedTabs({ tabs, activeId });

describe("deepLinkDashboardId", () => {
  it("reads the authenticated /dashboards/:id route", () => {
    expect(deepLinkDashboardId("/dashboards/abc")).toBe("abc");
    expect(deepLinkDashboardId("/dashboards/abc/")).toBe("abc");
  });
  it("ignores the public viewer, other routes and the root", () => {
    expect(deepLinkDashboardId("/dashboards/abc/panels")).toBeNull();
    expect(deepLinkDashboardId("/home")).toBeNull();
    expect(deepLinkDashboardId("/")).toBeNull();
  });
});

describe("normalizeSavedTabs (spray-json omits None)", () => {
  it("turns absent lastViewedAt/ownWriteAt/activeId into null", () => {
    expect(normalizeSavedTabs({ tabs: [{ id: "a" }] })).toEqual({
      tabs: [{ id: "a", lastViewedAt: null, ownWriteAt: null }],
      activeId: null,
    });
  });
  it("is null when the key was never set", () => {
    expect(normalizeSavedTabs(undefined)).toBeNull();
  });
});

describe("planHydration (design D1 'Hydration')", () => {
  it("restores the saved active tab and keeps the saved set untouched (nothing to write back)", () => {
    const plan = planHydration({
      saved: saved([{ id: "a" }, { id: "b" }], "b"),
      dashboardIds: ids("a", "b", "c"),
      autoSelectedId: "c",
      deepLinkId: null,
    });
    expect(plan.target).toBe("b");
    expect(plan.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(plan.dirty).toBe(false);
  });

  it("a deep link beats the saved active tab; an open tab is only activated", () => {
    const plan = planHydration({
      saved: saved([{ id: "a" }, { id: "b" }], "b"),
      dashboardIds: ids("a", "b"),
      autoSelectedId: "a",
      deepLinkId: "a",
    });
    expect(plan.target).toBe("a");
    expect(plan.tabs.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("a deep link to a dashboard that is not open opens it as a new tab after the active one", () => {
    const plan = planHydration({
      saved: saved([{ id: "a" }, { id: "b" }], "a"),
      dashboardIds: ids("a", "b", "c"),
      autoSelectedId: "a",
      deepLinkId: "c",
    });
    expect(plan.target).toBe("c");
    expect(plan.tabs.map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(plan.dirty).toBe(true);
  });

  it("a deep link to an unknown dashboard is ignored", () => {
    const plan = planHydration({
      saved: saved([{ id: "a" }], "a"),
      dashboardIds: ids("a"),
      autoSelectedId: "a",
      deepLinkId: "zzz",
    });
    expect(plan.target).toBe("a");
  });

  it("prunes saved tabs whose dashboard no longer exists and drops duplicate ids", () => {
    const plan = planHydration({
      saved: saved([{ id: "a" }, { id: "gone" }, { id: "a" }, { id: "b" }], "b"),
      dashboardIds: ids("a", "b"),
      autoSelectedId: "a",
      deepLinkId: null,
    });
    expect(plan.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(plan.dirty).toBe(true);
  });

  it("when the saved active tab is gone, the most recently viewed surviving tab is chosen", () => {
    const plan = planHydration({
      saved: saved(
        [
          { id: "a", lastViewedAt: "2026-01-01T00:00:00.000Z" },
          { id: "b", lastViewedAt: "2026-01-01T00:05:00.000Z" },
          { id: "gone" },
        ],
        "gone",
      ),
      dashboardIds: ids("a", "b"),
      autoSelectedId: "a",
      deepLinkId: null,
    });
    expect(plan.target).toBe("b");
    expect(plan.tabs).toHaveLength(2);
  });

  it("a stored EMPTY set stays empty: no auto-selection", () => {
    const plan = planHydration({
      saved: saved([], null),
      dashboardIds: ids("a", "b"),
      autoSelectedId: "a",
      deepLinkId: null,
    });
    expect(plan.target).toBeNull();
    expect(plan.tabs).toEqual([]);
  });

  it("no saved key at all: the reducer's auto-selection becomes the only tab", () => {
    const plan = planHydration({
      saved: null,
      dashboardIds: ids("a", "b"),
      autoSelectedId: "a",
      deepLinkId: null,
    });
    expect(plan.target).toBe("a");
    expect(plan.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(plan.dirty).toBe(true);
  });

  it("no saved key and no dashboard: nothing is selected and NOTHING is saved (an empty set would later suppress auto-selection)", () => {
    const plan = planHydration({
      saved: null,
      dashboardIds: ids(),
      autoSelectedId: null,
      deepLinkId: null,
    });
    expect(plan.target).toBeNull();
    expect(plan.tabs).toEqual([]);
    expect(plan.dirty).toBe(false);
  });

  it("a saved set that was entirely pruned falls back to the auto-selection", () => {
    const plan = planHydration({
      saved: saved([{ id: "gone1" }, { id: "gone2" }], "gone1"),
      dashboardIds: ids("a"),
      autoSelectedId: "a",
      deepLinkId: null,
    });
    expect(plan.target).toBe("a");
    expect(plan.tabs.map((t) => t.id)).toEqual(["a"]);
  });

  it("no dashboards at all: no target, no tabs", () => {
    const plan = planHydration({
      saved: null,
      dashboardIds: ids(),
      autoSelectedId: null,
      deepLinkId: null,
    });
    expect(plan.target).toBeNull();
    expect(plan.tabs).toEqual([]);
  });
});

describe("hydrateTabs honours the browser copy's lastViewedAt (HEL-1575 final-gate r2)", () => {
  beforeEach(async () => {
    changesMock.mockReset();
    changesMock.mockResolvedValue({
      serverNow: new Date().toISOString(),
      items: [
        {
          dashboardId: "a",
          contentUpdatedAt: "2026-01-01T00:00:00Z",
          dataUpdatedAt: null,
          outputs: [],
        },
      ],
    });
    await clearWarmState();
  });

  async function hydrateWithSavedStamp(savedAt: string, storedAt: number) {
    const harness = makeTabsStore({
      dashboards: [dash("a")],
      selected: "a",
      hydrated: false,
      user: testUser({ tabs: [{ id: "a", lastViewedAt: savedAt }], activeId: "a" }),
    });
    await getWarmStore().write(
      storedEntry({
        dashboardId: "a",
        contentCapturedAt: Date.now() - 3_600_000,
        lastViewedAt: storedAt,
        panels: [outputPanel("pa1", "a", "o1")],
      }),
    );
    await harness.dispatch(hydrateTabs());
    return harness;
  }

  it("an idle active tab whose saved stamp is past the TTL is still warm on reload via the copy's stamp", async () => {
    const harness = await hydrateWithSavedStamp(
      new Date(Date.now() - 60 * 60_000).toISOString(),
      Date.now() - 30_000,
    );
    expect(getListEntry("a")).toBeDefined();
    const stamp = harness.getState().dashboardTabs.tabs[0].lastViewedAt;
    expect(Date.now() - Date.parse(stamp as string)).toBeLessThan(60_000);
  });

  it("when neither the saved stamp nor the copy's is within the TTL the tab stays cold", async () => {
    const old = Date.now() - 60 * 60_000;
    const harness = await hydrateWithSavedStamp(new Date(old).toISOString(), old);
    expect(getListEntry("a")).toBeUndefined();
    expect(harness.getState().dashboardTabs.tabs[0].lastViewedAt).toBe(new Date(old).toISOString());
  });
});

describe("hydrateTabs: a navigation made while hydration awaits wins (HEL-1754)", () => {
  type ChangesResult = Awaited<ReturnType<typeof fetchDashboardChanges>>;
  let releaseSignals: (value: ChangesResult) => void;

  beforeEach(async () => {
    window.history.pushState({}, "", "/home");
    changesMock.mockReset();
    changesMock.mockImplementation(
      () =>
        new Promise<ChangesResult>((resolve) => {
          releaseSignals = resolve;
        }),
    );
    await clearWarmState();
  });
  afterEach(() => window.history.pushState({}, "", "/"));

  const signals = (): ChangesResult => ({
    serverNow: new Date().toISOString(),
    items: [
      {
        dashboardId: "a",
        contentUpdatedAt: "2026-01-01T00:00:00Z",
        dataUpdatedAt: null,
        outputs: [],
      },
      {
        dashboardId: "b",
        contentUpdatedAt: "2026-01-01T00:00:00Z",
        dataUpdatedAt: null,
        outputs: [],
      },
    ],
  });

  function savedStore() {
    return makeTabsStore({
      dashboards: [dash("a"), dash("b")],
      selected: "a",
      hydrated: false,
      user: testUser({ tabs: [{ id: "a" }, { id: "b" }], activeId: "b" }),
    });
  }

  it("the dashboard opened (location change) during the signal fetch stays selected and active", async () => {
    const harness = savedStore();
    const done = harness.dispatch(hydrateTabs());
    await Promise.resolve();
    window.history.pushState({}, "", "/dashboards/a");
    releaseSignals(signals());
    await done;
    const state = harness.getState();
    expect(state.dashboards.selectedDashboardId).toBe("a");
    expect(state.dashboardTabs.activeId).toBe("a");
    expect(state.dashboardTabs.hydrated).toBe(true);
  });

  it("a navigation to a dashboard that is not an open tab opens it as the active tab", async () => {
    const harness = makeTabsStore({
      dashboards: [dash("a"), dash("b"), dash("c")],
      selected: "a",
      hydrated: false,
      user: testUser({ tabs: [{ id: "a" }, { id: "b" }], activeId: "b" }),
    });
    const done = harness.dispatch(hydrateTabs());
    await Promise.resolve();
    window.history.pushState({}, "", "/dashboards/c");
    releaseSignals(signals());
    await done;
    const tabs = harness.getState().dashboardTabs;
    expect(tabs.activeId).toBe("c");
    expect(tabs.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(harness.getState().dashboards.selectedDashboardId).toBe("c");
  });

  it("no navigation: the saved active tab is still restored (selection alone is not a navigation)", async () => {
    const harness = savedStore();
    const done = harness.dispatch(hydrateTabs());
    await Promise.resolve();
    releaseSignals(signals());
    await done;
    const state = harness.getState();
    expect(state.dashboards.selectedDashboardId).toBe("b");
    expect(state.dashboardTabs.activeId).toBe("b");
  });

  // GUARD, not a red-first test: it passes on the base code too. It pins that hydration never applies a warm copy for the
  // re-planned target itself, so that copy is only ever served through showDashboardPanels' signal validity check.
  it("guard: hydration does not restore the re-planned target's warm copy (left to showDashboardPanels' validity check)", async () => {
    const harness = savedStore();
    await getWarmStore().write(
      storedEntry({
        dashboardId: "a",
        contentCapturedAt: Date.now() - 3_600_000,
        lastViewedAt: Date.now() - 30_000,
        panels: [outputPanel("pa1", "a", "o1")],
      }),
    );
    const done = harness.dispatch(hydrateTabs());
    await Promise.resolve();
    window.history.pushState({}, "", "/dashboards/a");
    releaseSignals(signals());
    await done;
    expect(getListEntry("a")).toBeUndefined();
  });
});
