import { clearAuth } from "../../auth/state/authSlice";
import {
  activateTab,
  changeSignalsReceived,
  clearActiveTab,
  closeTab,
  dashboardTabsReducer,
  initialDashboardTabsState,
  moveTab,
  openTabActivate,
  openTabInBackground,
  replaceActiveTab,
  tabOwnWrite,
  tabsPruned,
  tabViewed,
  type DashboardTabsState,
} from "./dashboardTabsSlice";
import { MAX_TABS, type DashboardTab } from "./tabTypes";

function tab(id: string, lastViewedAt: string | null = null): DashboardTab {
  return { id, lastViewedAt, ownWriteAt: null };
}
function stateOf(ids: string[], activeId: string | null = null): DashboardTabsState {
  return { ...initialDashboardTabsState, tabs: ids.map((id) => tab(id)), activeId, hydrated: true };
}
const ids = (s: DashboardTabsState) => s.tabs.map((t) => t.id);

describe("dashboardTabsSlice (HEL-1575 D1/D3)", () => {
  it("openTabInBackground inserts after the active tab without changing it, and is a no-op if open", () => {
    let s = stateOf(["a", "b", "c"], "a");
    s = dashboardTabsReducer(s, openTabInBackground("x"));
    expect(ids(s)).toEqual(["a", "x", "b", "c"]);
    expect(s.activeId).toBe("a");
    s = dashboardTabsReducer(s, openTabInBackground("c"));
    expect(ids(s)).toEqual(["a", "x", "b", "c"]);
  });

  it("openTabActivate inserts after the active tab and activates; an open tab is only activated", () => {
    let s = stateOf(["a", "b"], "a");
    s = dashboardTabsReducer(s, openTabActivate("x"));
    expect(ids(s)).toEqual(["a", "x", "b"]);
    expect(s.activeId).toBe("x");
    s = dashboardTabsReducer(s, openTabActivate("b"));
    expect(ids(s)).toEqual(["a", "x", "b"]);
    expect(s.activeId).toBe("b");
  });

  it("opens at the end when there is no active tab", () => {
    const s = dashboardTabsReducer(stateOf(["a", "b"], null), openTabActivate("x"));
    expect(ids(s)).toEqual(["a", "b", "x"]);
  });

  it("activateTab ignores an unknown id", () => {
    const s = dashboardTabsReducer(stateOf(["a", "b"], "a"), activateTab("zzz"));
    expect(s.activeId).toBe("a");
  });

  it("replaceActiveTab swaps the active tab's id in place and drops its timestamps", () => {
    let s = stateOf(["a", "b", "c"], "b");
    s = dashboardTabsReducer(s, tabViewed({ id: "b", at: "2026-01-01T00:00:00.000Z" }));
    s = dashboardTabsReducer(s, replaceActiveTab("x"));
    expect(ids(s)).toEqual(["a", "x", "c"]);
    expect(s.activeId).toBe("x");
    expect(s.tabs[1].lastViewedAt).toBeNull();
  });

  it("replaceActiveTab with no tabs makes the dashboard the only tab", () => {
    const s = dashboardTabsReducer(stateOf([], null), replaceActiveTab("x"));
    expect(ids(s)).toEqual(["x"]);
    expect(s.activeId).toBe("x");
  });

  it("clearActiveTab leaves the tabs and clears the active one", () => {
    const s = dashboardTabsReducer(stateOf(["a", "b"], "a"), clearActiveTab());
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.activeId).toBeNull();
  });

  describe("closeTab neighbour rule", () => {
    it("closing the active tab selects the right neighbour", () => {
      const s = dashboardTabsReducer(stateOf(["a", "b", "c"], "b"), closeTab("b"));
      expect(ids(s)).toEqual(["a", "c"]);
      expect(s.activeId).toBe("c");
    });
    it("else the left neighbour", () => {
      const s = dashboardTabsReducer(stateOf(["a", "b", "c"], "c"), closeTab("c"));
      expect(s.activeId).toBe("b");
    });
    it("else none", () => {
      const s = dashboardTabsReducer(stateOf(["a"], "a"), closeTab("a"));
      expect(ids(s)).toEqual([]);
      expect(s.activeId).toBeNull();
    });
    it("closing an inactive tab keeps the active tab", () => {
      const s = dashboardTabsReducer(stateOf(["a", "b", "c"], "a"), closeTab("c"));
      expect(s.activeId).toBe("a");
      expect(ids(s)).toEqual(["a", "b"]);
    });
  });

  it("moveTab reorders and clamps the target index", () => {
    let s = stateOf(["a", "b", "c"], "a");
    s = dashboardTabsReducer(s, moveTab({ id: "a", toIndex: 2 }));
    expect(ids(s)).toEqual(["b", "c", "a"]);
    s = dashboardTabsReducer(s, moveTab({ id: "a", toIndex: -5 }));
    expect(ids(s)).toEqual(["a", "b", "c"]);
  });

  describe("D3 cap of 20 with LRU eviction", () => {
    function full(): DashboardTabsState {
      const tabs = Array.from({ length: MAX_TABS }, (_, i) =>
        tab(`t${i}`, `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`),
      );
      return { ...initialDashboardTabsState, tabs, activeId: "t10", hydrated: true };
    }

    it("a 21st tab closes the inactive tab with the oldest lastViewedAt", () => {
      const s = dashboardTabsReducer(full(), openTabActivate("new"));
      expect(s.tabs).toHaveLength(MAX_TABS);
      expect(ids(s)).not.toContain("t0");
      expect(ids(s)).toContain("new");
    });

    it("null lastViewedAt counts as oldest, ties go to the leftmost", () => {
      const base = full();
      base.tabs[5] = tab("t5", null);
      base.tabs[7] = tab("t7", null);
      const s = dashboardTabsReducer(base, openTabInBackground("new"));
      expect(ids(s)).not.toContain("t5");
      expect(ids(s)).toContain("t7");
    });

    it("never evicts the active tab, even when it is the oldest", () => {
      const base = full();
      base.activeId = "t0";
      const s = dashboardTabsReducer(base, openTabActivate("new"));
      expect(ids(s)).toContain("t0");
      expect(ids(s)).not.toContain("t1");
    });
  });

  it("tabsPruned removes missing tabs and applies the neighbour rule to the active one", () => {
    const s = dashboardTabsReducer(stateOf(["a", "b", "c"], "b"), tabsPruned(["b", "a"]));
    expect(ids(s)).toEqual(["c"]);
    expect(s.activeId).toBe("c");
  });

  it("tabOwnWrite only moves forward and ignores unknown tabs", () => {
    let s = stateOf(["a"], "a");
    s = dashboardTabsReducer(s, tabOwnWrite({ id: "a", at: "2026-01-01T00:00:10.000Z" }));
    s = dashboardTabsReducer(s, tabOwnWrite({ id: "a", at: "2026-01-01T00:00:05.000Z" }));
    expect(s.tabs[0].ownWriteAt).toBe("2026-01-01T00:00:10.000Z");
    s = dashboardTabsReducer(s, tabOwnWrite({ id: "zzz", at: "2026-01-01T00:00:20.000Z" }));
    expect(s.tabs).toHaveLength(1);
  });

  it("changeSignalsReceived stores per-dashboard signals and the offset", () => {
    const s = dashboardTabsReducer(
      stateOf(["a"]),
      changeSignalsReceived({
        items: [{ dashboardId: "a", contentUpdatedAt: "x", dataUpdatedAt: null, outputs: [] }],
        serverOffsetMs: 1234,
      }),
    );
    expect(s.changeSignals.a.contentUpdatedAt).toBe("x");
    expect(s.serverOffsetMs).toBe(1234);
  });

  it("clearAuth resets everything (logout and the 401 path)", () => {
    const s = dashboardTabsReducer(stateOf(["a", "b"], "a"), clearAuth());
    expect(s).toEqual(initialDashboardTabsState);
    expect(s.hydrated).toBe(false);
  });
});
