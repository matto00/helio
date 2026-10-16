import {
  createDashboard,
  dashboardRemoved,
  deleteDashboard,
  duplicateDashboard,
  fetchDashboards,
  importDashboard,
  applyProposal,
  setSelectedDashboardId,
} from "../state/dashboardsSlice";
import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import {
  activateTab,
  closeTab,
  openTabActivate,
  openTabInBackground,
  tabsHydrated,
} from "./dashboardTabsSlice";
import { resetTabsListenerState } from "./dashboardTabsListeners";
import { scheduleTabsWrite } from "./tabsPersistence";

jest.mock("./tabsPersistence", () => ({
  ...jest.requireActual("./tabsPersistence"),
  scheduleTabsWrite: jest.fn(),
  cancelTabsWrite: jest.fn(),
}));
jest.mock("./dashboardChangesService", () => ({
  fetchDashboardChanges: jest
    .fn()
    .mockResolvedValue({ serverNow: "2026-01-01T00:00:00Z", items: [] }),
}));
jest.mock("../../panels/services/panelService", () => ({
  fetchPanels: jest.fn().mockResolvedValue([]),
}));
jest.mock("../services/dashboardService", () => ({ fetchDashboards: jest.fn() }));

const scheduleMock = jest.mocked(scheduleTabsWrite);
const D = [dash("a"), dash("b"), dash("c")];
const ids = (getState: () => { dashboardTabs: { tabs: { id: string }[] } }) =>
  getState().dashboardTabs.tabs.map((t) => t.id);

beforeEach(() => {
  scheduleMock.mockReset();
  resetTabsListenerState();
});

describe("selection state-transition listener (design D1)", () => {
  it("is inert until hydrated: a selection change before hydration touches no tab", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      dashboardsStatus: "idle",
      hydrated: false,
    });
    dispatch(setSelectedDashboardId("a"));
    expect(getState().dashboardTabs.tabs).toEqual([]);
    expect(getState().dashboardTabs.activeId).toBeNull();
  });

  it("selecting a dashboard that is already open activates its tab (setSelectedDashboardId)", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    dispatch(setSelectedDashboardId("b"));
    expect(getState().dashboardTabs.activeId).toBe("b");
    expect(ids(getState)).toEqual(["a", "b"]);
  });

  it("selecting a known dashboard that is not open REPLACES the active tab in place", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    dispatch(setSelectedDashboardId("c"));
    expect(ids(getState)).toEqual(["c", "b"]);
    expect(getState().dashboardTabs.activeId).toBe("c");
  });

  it("a null selection leaves the tabs and clears the active one", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a")],
      activeId: "a",
      selected: "a",
    });
    dispatch(setSelectedDashboardId(null));
    expect(ids(getState)).toEqual(["a"]);
    expect(getState().dashboardTabs.activeId).toBeNull();
  });

  it.each([
    [
      "createDashboard",
      (d: ReturnType<typeof dash>) => createDashboard.fulfilled(d, "r", { name: "x" }),
    ],
    [
      "duplicateDashboard",
      (d: ReturnType<typeof dash>) =>
        duplicateDashboard.fulfilled({ dashboard: d, panels: [] }, "r", "a"),
    ],
    [
      "importDashboard",
      (d: ReturnType<typeof dash>) =>
        importDashboard.fulfilled({ dashboard: d, panels: [] }, "r", {} as never),
    ],
    [
      "applyProposal",
      (d: ReturnType<typeof dash>) =>
        applyProposal.fulfilled({ dashboard: d, panels: [] } as never, "r", {} as never),
    ],
  ])("%s opens the new dashboard as a tab after the active one and activates it", (_name, make) => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    dispatch(make(dash("new")));
    expect(ids(getState)).toEqual(["a", "new", "b"]);
    expect(getState().dashboardTabs.activeId).toBe("new");
    expect(getState().dashboards.selectedDashboardId).toBe("new");
  });

  it("fetchDashboards.fulfilled (the boot auto-select) follows the same state-transition rule", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: [],
      dashboardsStatus: "idle",
      tabs: [tab("a")],
      activeId: "a",
      selected: "a",
    });
    // The selected dashboard vanished from the refetched list: the reducer picks the most recent.
    dispatch(fetchDashboards.fulfilled([dash("b"), dash("c")], "r"));
    expect(getState().dashboards.selectedDashboardId).not.toBe("a");
    expect(getState().dashboardTabs.activeId).toBe(getState().dashboards.selectedDashboardId);
  });

  describe("removal: the neighbour rule overrides the reducer's most-recent pick", () => {
    it("deleteDashboard.fulfilled of the active tab selects its RIGHT neighbour", () => {
      const { dispatch, getState } = makeTabsStore({
        dashboards: [dash("a"), dash("b"), dash("c")],
        tabs: [tab("c"), tab("b"), tab("a")],
        activeId: "b",
        selected: "b",
      });
      // The reducer alone would pick the most recent dashboard, "a".
      dispatch(deleteDashboard.fulfilled("b", "r", "b"));
      expect(ids(getState)).toEqual(["c", "a"]);
      expect(getState().dashboardTabs.activeId).toBe("a");
      expect(getState().dashboards.selectedDashboardId).toBe("a");
    });

    it("dashboardRemoved of the last tab selects the left neighbour", () => {
      const { dispatch, getState } = makeTabsStore({
        dashboards: [dash("a"), dash("b"), dash("c")],
        tabs: [tab("c"), tab("b")],
        activeId: "b",
        selected: "b",
      });
      dispatch(dashboardRemoved("b"));
      expect(getState().dashboardTabs.activeId).toBe("c");
      expect(getState().dashboards.selectedDashboardId).toBe("c");
    });

    it("removing the only tab leaves no active tab and no selection", () => {
      const { dispatch, getState } = makeTabsStore({
        dashboards: [dash("a")],
        tabs: [tab("a")],
        activeId: "a",
        selected: "a",
      });
      dispatch(deleteDashboard.fulfilled("a", "r", "a"));
      expect(ids(getState)).toEqual([]);
      expect(getState().dashboardTabs.activeId).toBeNull();
      expect(getState().dashboards.selectedDashboardId).toBeNull();
    });

    it("deleting an INACTIVE open dashboard prunes its tab and keeps the active one", () => {
      const { dispatch, getState } = makeTabsStore({
        dashboards: [dash("a"), dash("b"), dash("c")],
        tabs: [tab("a"), tab("b")],
        activeId: "a",
        selected: "a",
      });
      dispatch(deleteDashboard.fulfilled("b", "r", "b"));
      expect(ids(getState)).toEqual(["a"]);
      expect(getState().dashboardTabs.activeId).toBe("a");
    });
  });

  it("prunes tabs whose dashboard is absent from a refetched list", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("gone")],
      activeId: "a",
      selected: "a",
    });
    dispatch(fetchDashboards.fulfilled([dash("a"), dash("b")], "r"));
    expect(ids(getState)).toEqual(["a"]);
  });
});

describe("explicit tab actions drive the selection", () => {
  it("activateTab selects that dashboard", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    dispatch(activateTab("b"));
    expect(getState().dashboards.selectedDashboardId).toBe("b");
  });

  it("openTabActivate selects the new tab; openTabInBackground changes neither tab nor selection", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a")],
      activeId: "a",
      selected: "a",
    });
    dispatch(openTabInBackground("b"));
    expect(getState().dashboardTabs.activeId).toBe("a");
    expect(getState().dashboards.selectedDashboardId).toBe("a");
    dispatch(openTabActivate("c"));
    expect(getState().dashboards.selectedDashboardId).toBe("c");
    expect(ids(getState)).toEqual(["a", "c", "b"]);
  });

  it("closeTab of the active tab selects the neighbour", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    dispatch(closeTab("a"));
    expect(getState().dashboards.selectedDashboardId).toBe("b");
  });
});

describe("last-viewed stamping", () => {
  it("stamps the tab being left, and gives a never-viewed arriving tab its first stamp", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b")],
      activeId: "a",
      selected: "a",
    });
    dispatch(activateTab("b"));
    const [a, b] = getState().dashboardTabs.tabs;
    expect(a.lastViewedAt).not.toBeNull();
    expect(b.lastViewedAt).not.toBeNull();
  });

  it("an arriving tab that already has a stamp KEEPS it (the warm TTL runs from when it was left)", () => {
    const { dispatch, getState } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a"), tab("b", "2026-01-01T00:00:00.000Z")],
      activeId: "a",
      selected: "a",
    });
    dispatch(activateTab("b"));
    expect(getState().dashboardTabs.tabs[1].lastViewedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("persistence listener (design D2)", () => {
  it("schedules a write for every change after hydration", () => {
    const { dispatch } = makeTabsStore({
      dashboards: D,
      tabs: [tab("a")],
      activeId: "a",
      selected: "a",
    });
    dispatch(openTabInBackground("b"));
    expect(scheduleMock).toHaveBeenCalled();
    const wire = scheduleMock.mock.calls.at(-1)?.[0];
    expect(wire?.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(wire?.activeId).toBe("a");
  });

  it("does not write a pure restore (persist: false) but does write a changed hydration", () => {
    const { dispatch } = makeTabsStore({
      dashboards: D,
      dashboardsStatus: "idle",
      hydrated: false,
    });
    dispatch(
      tabsHydrated({
        tabs: [tab("a", "2026-01-01T00:00:00.000Z")],
        activeId: "a",
        persist: false,
      }),
    );
    expect(scheduleMock).not.toHaveBeenCalled();
    const second = makeTabsStore({ dashboards: D, dashboardsStatus: "idle", hydrated: false });
    second.dispatch(
      tabsHydrated({ tabs: [tab("a", "2026-01-01T00:00:00.000Z")], activeId: "a", persist: true }),
    );
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it("writes nothing before hydration", () => {
    const { dispatch } = makeTabsStore({
      dashboards: D,
      dashboardsStatus: "idle",
      hydrated: false,
    });
    dispatch(openTabInBackground("a"));
    expect(scheduleMock).not.toHaveBeenCalled();
  });
});
