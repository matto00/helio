import {
  createDashboard,
  dashboardPipelineFedObserved,
  dashboardsReducer,
  dashboardUpserted,
  fetchDashboards,
  renameDashboard,
  repairDashboardLayout,
  updateDashboardAppearance,
  updateDashboardLayout,
} from "./dashboardsSlice";
import type { Dashboard } from "../types/dashboard";

const meta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};
const appearance = { background: "transparent", gridBackground: "transparent" };
const layout = { lg: [], md: [], sm: [], xs: [] };
const dash = (over: Partial<Dashboard> = {}): Dashboard => ({
  id: "d1",
  name: "Ops",
  meta,
  appearance,
  layout,
  ...over,
});

// The list route emits the flag; every other single-dashboard response omits it (HEL-1646).
const listed = (flag: boolean | undefined) =>
  dashboardsReducer(
    undefined,
    fetchDashboards.fulfilled([dash({ hasPipelineFedPanels: flag })], "r", undefined),
  );

describe("hasPipelineFedPanels on the dashboards slice (HEL-1646)", () => {
  it("takes the wire value from the list fetch, overwriting a previous one", () => {
    const state = dashboardsReducer(
      listed(true),
      fetchDashboards.fulfilled([dash({ hasPipelineFedPanels: false })], "r2", undefined),
    );
    expect(state.items[0].hasPipelineFedPanels).toBe(false);
  });

  it("keeps the known value when dashboardUpserted carries none (409 resync, proposals, first run)", () => {
    const state = dashboardsReducer(listed(true), dashboardUpserted(dash({ name: "Renamed" })));
    expect(state.items[0]).toMatchObject({ name: "Renamed", hasPipelineFedPanels: true });
  });

  it("lets an upsert that does carry the flag replace it", () => {
    const state = dashboardsReducer(
      listed(true),
      dashboardUpserted(dash({ hasPipelineFedPanels: false })),
    );
    expect(state.items[0].hasPipelineFedPanels).toBe(false);
  });

  it("keeps the known value across rename and appearance responses", () => {
    let state = dashboardsReducer(
      listed(true),
      renameDashboard.fulfilled(dash({ name: "New" }), "r", { dashboardId: "d1", name: "New" }),
    );
    expect(state.items[0]).toMatchObject({ name: "New", hasPipelineFedPanels: true });
    state = dashboardsReducer(
      state,
      updateDashboardAppearance.fulfilled(dash({ name: "New" }), "r", {
        dashboardId: "d1",
        appearance: {},
      } as never),
    );
    expect(state.items[0].hasPipelineFedPanels).toBe(true);
  });

  it("keeps the known value across layout saves, both adopting and keep-local-layout paths", () => {
    const moved = { ...layout, lg: [{ panelId: "p", x: 1, y: 0, w: 2, h: 2 }] };
    const adopt = dashboardsReducer(
      listed(true),
      updateDashboardLayout.fulfilled(dash({ layout: moved }), "r", {
        dashboardId: "d1",
        layout: moved,
        sentLayout: moved,
      } as never),
    );
    // sentLayout differs from the store's layout, so this takes the keepLocalLayout branch.
    expect(adopt.items[0].hasPipelineFedPanels).toBe(true);
    const adopted = dashboardsReducer(
      listed(true),
      updateDashboardLayout.fulfilled(dash(), "r", {
        dashboardId: "d1",
        layout,
        sentLayout: layout,
      } as never),
    );
    expect(adopted.items[0].hasPipelineFedPanels).toBe(true);
  });

  it("keeps the known value across a layout repair, both branches", () => {
    const other = { ...layout, lg: [{ panelId: "p", x: 1, y: 0, w: 2, h: 2 }] };
    for (const expectedLayout of [layout, other]) {
      const state = dashboardsReducer(
        listed(true),
        repairDashboardLayout.fulfilled(dash(), "r", {
          dashboardId: "d1",
          layout: {},
          expectedLayout,
        }),
      );
      expect(state.items[0].hasPipelineFedPanels).toBe(true);
    }
  });

  it("leaves a brand-new dashboard's flag unknown (create response omits it)", () => {
    const state = dashboardsReducer(
      undefined,
      createDashboard.fulfilled(dash(), "r", { name: "Ops" } as never),
    );
    expect(state.items[0].hasPipelineFedPanels).toBeUndefined();
  });

  it("dashboardPipelineFedObserved writes the flag, and ignores an unknown id", () => {
    let state = dashboardsReducer(
      listed(undefined),
      dashboardPipelineFedObserved({ dashboardId: "d1", value: true }),
    );
    expect(state.items[0].hasPipelineFedPanels).toBe(true);
    state = dashboardsReducer(
      state,
      dashboardPipelineFedObserved({ dashboardId: "nope", value: false }),
    );
    expect(state.items).toHaveLength(1);
    expect(state.items[0].hasPipelineFedPanels).toBe(true);
  });
});
