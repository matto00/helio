import { duplicateDashboard, importDashboard } from "../../dashboards/state/dashboardsSlice";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { fetchPanels, panelsReducer, panelsRestored } from "./panelsSlice";

// HEL-1584 D4: where the panels came from (`itemsOrigin`) and which load they belong to (`loadId`), so the grid's
// cold-load entrance can play at most once per network load and never for a warm restore.

const panel = makeOutputPanel({ id: "p1", dashboardId: "d1" });
const dashboard = {
  id: "d2",
  name: "Copy",
  meta: { createdBy: "u", createdAt: "2026-03-14T00:00:00Z", lastUpdated: "2026-03-14T00:00:00Z" },
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
};

describe("panelsSlice itemsOrigin and loadId (HEL-1584 D4)", () => {
  it("starts as a network origin at load 0", () => {
    const state = panelsReducer(undefined, { type: "@@INIT" });
    expect(state.itemsOrigin).toBe("network");
    expect(state.loadId).toBe(0);
  });

  it("fetchPanels.fulfilled marks the panels network-loaded and bumps the load id", () => {
    const first = panelsReducer(undefined, fetchPanels.fulfilled([panel], "r1", "d1"));
    expect(first).toMatchObject({ itemsOrigin: "network", loadId: 1 });
    const second = panelsReducer(first, fetchPanels.fulfilled([panel], "r2", "d1"));
    expect(second.loadId).toBe(2);
  });

  it("a duplicated or imported dashboard is a first showing: network origin, load id + 1", () => {
    const dup = panelsReducer(
      undefined,
      duplicateDashboard.fulfilled({ dashboard, panels: [panel] }, "r", "d1"),
    );
    expect(dup).toMatchObject({ itemsOrigin: "network", loadId: 1 });
    const imp = panelsReducer(
      dup,
      importDashboard.fulfilled({ dashboard, panels: [panel] }, "r", {
        version: 2,
        dashboard: { name: "x", appearance: {}, layout: { lg: [], md: [], sm: [], xs: [] } },
        panels: [],
      }),
    );
    expect(imp).toMatchObject({ itemsOrigin: "network", loadId: 2 });
  });

  it("panelsRestored marks the panels restored and leaves the load id alone", () => {
    const loaded = panelsReducer(undefined, fetchPanels.fulfilled([panel], "r1", "d1"));
    const restored = panelsReducer(loaded, panelsRestored({ dashboardId: "d2", items: [panel] }));
    expect(restored.itemsOrigin).toBe("restored");
    expect(restored.loadId).toBe(1);
    const again = panelsReducer(restored, fetchPanels.fulfilled([panel], "r3", "d2"));
    expect(again).toMatchObject({ itemsOrigin: "network", loadId: 2 });
  });
});
