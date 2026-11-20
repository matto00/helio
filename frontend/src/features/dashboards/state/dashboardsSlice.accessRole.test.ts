import {
  dashboardsReducer,
  dashboardUpserted,
  fetchDashboards,
  deleteDashboard,
  renameDashboard,
  updateDashboardLayout,
  repairDashboardLayout,
  createDashboard,
  applyProposal,
} from "./dashboardsSlice";
import type { Dashboard } from "../types/dashboard";

const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};
const layout = { lg: [], md: [], sm: [], xs: [] };

function dash(id: string, extra: Partial<Dashboard> = {}): Dashboard {
  return {
    id,
    name: id,
    meta,
    appearance: { background: "transparent", gridBackground: "transparent" },
    layout,
    ...extra,
  };
}

function seeded(items: Dashboard[]) {
  return dashboardsReducer(undefined, fetchDashboards.fulfilled(items, "r"));
}

describe("dashboardsSlice accessRole (HEL-1773)", () => {
  it("lands on the newest OWNED dashboard, never a newer shared one", () => {
    const state = seeded([
      dash("shared-new", { accessRole: "viewer" }),
      dash("own-old", { accessRole: "owner" }),
    ]);
    expect(state.selectedDashboardId).toBe("own-old");
    expect(state.items.map((d) => d.id)).toEqual(["shared-new", "own-old"]);
  });

  // HEL-1782 owner ruling 1 (2026-11-19) REVERSES the HEL-1773 behaviour that selected nothing here: a user who owns no
  // dashboard lands on the most recently updated shared one (the list arrives newest first).
  it("selects the most recently updated shared dashboard when none is owned (HEL-1782 owner ruling 1)", () => {
    const state = seeded([
      dash("a", { accessRole: "editor" }),
      dash("b", { accessRole: "viewer" }),
    ]);
    expect(state.selectedDashboardId).toBe("a");
    expect(state.items).toHaveLength(2);
  });

  it("an owned dashboard still beats a newer shared one, so the fallback only applies when none is owned", () => {
    const state = seeded([
      dash("new", { accessRole: "viewer" }),
      dash("mine", { accessRole: "owner" }),
    ]);
    expect(state.selectedDashboardId).toBe("mine");
  });

  it("deleting the last owned dashboard falls back to the newest shared one", () => {
    let state = seeded([
      dash("shared", { accessRole: "viewer" }),
      dash("own", { accessRole: "owner" }),
    ]);
    expect(state.selectedDashboardId).toBe("own");
    state = dashboardsReducer(state, deleteDashboard.fulfilled("own", "r", "own"));
    expect(state.selectedDashboardId).toBe("shared");
  });

  it("deleting the selected dashboard re-lands on an owned one", () => {
    let state = seeded([
      dash("shared", { accessRole: "viewer" }),
      dash("own1", { accessRole: "owner" }),
      dash("own2", { accessRole: "owner" }),
    ]);
    expect(state.selectedDashboardId).toBe("own1");
    state = dashboardsReducer(state, deleteDashboard.fulfilled("own1", "r", "own1"));
    expect(state.selectedDashboardId).toBe("own2");
  });

  describe("a response that omits accessRole keeps the stored one (every merge site)", () => {
    const stored = dash("d", { accessRole: "editor", hasPipelineFedPanels: true });
    const withoutRole = dash("d", { name: "renamed" });

    it("rename", () => {
      const state = dashboardsReducer(
        seeded([stored]),
        renameDashboard.fulfilled(withoutRole, "r", { dashboardId: "d", name: "renamed" }),
      );
      expect(state.items[0]).toMatchObject({ name: "renamed", accessRole: "editor" });
    });

    it("layout save, when the response is adopted", () => {
      const state = dashboardsReducer(
        seeded([stored]),
        updateDashboardLayout.fulfilled(withoutRole, "r", {
          dashboardId: "d",
          layout,
          sentLayout: layout,
        } as never),
      );
      expect(state.items[0].accessRole).toBe("editor");
    });

    it("layout save, when a newer local layout is kept (keepLocalLayout)", () => {
      const newer = { ...layout, lg: [{ panelId: "p", x: 0, y: 0, w: 1, h: 1 }] };
      const base = seeded([stored]);
      const local = dashboardsReducer(base, {
        type: "dashboards/setDashboardLayoutLocally",
        payload: { dashboardId: "d", layout: newer },
      });
      const state = dashboardsReducer(
        local,
        updateDashboardLayout.fulfilled(withoutRole, "r", {
          dashboardId: "d",
          layout,
          sentLayout: layout,
        } as never),
      );
      expect(state.items[0]).toMatchObject({ accessRole: "editor", layout: newer });
    });

    it("layout repair", () => {
      const state = dashboardsReducer(
        seeded([stored]),
        repairDashboardLayout.fulfilled(withoutRole, "r", {
          dashboardId: "d",
          layout,
          expectedLayout: layout,
        } as never),
      );
      expect(state.items[0].accessRole).toBe("editor");
    });

    it("dashboardUpserted (a patch-set apply)", () => {
      const state = dashboardsReducer(seeded([stored]), dashboardUpserted(withoutRole));
      expect(state.items[0]).toMatchObject({ name: "renamed", accessRole: "editor" });
    });

    it("create / duplicate / applyProposal upsert by id and keep the stored role", () => {
      const viaCreate = dashboardsReducer(
        seeded([stored]),
        createDashboard.fulfilled(withoutRole, "r", { name: "x" }),
      );
      expect(viaCreate.items).toHaveLength(1);
      expect(viaCreate.items[0].accessRole).toBe("editor");
      const viaProposal = dashboardsReducer(
        seeded([stored]),
        applyProposal.fulfilled({ dashboard: withoutRole, panels: [] } as never, "r", {} as never),
      );
      expect(viaProposal.items[0].accessRole).toBe("editor");
    });

    it("a response that carries a role replaces the stored one", () => {
      const state = dashboardsReducer(
        seeded([stored]),
        dashboardUpserted(dash("d", { accessRole: "owner" })),
      );
      expect(state.items[0].accessRole).toBe("owner");
    });
  });
});
