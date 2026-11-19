import type { RootState } from "../../../store/store";
import type { Dashboard } from "../types/dashboard";
import {
  dashboardAccessRole,
  isKnownNonOwnedDashboard,
  isSharedDashboard,
  selectCanEditDashboard,
  selectDashboardAccessRole,
  selectIsDashboardOwner,
  selectOwnedDashboards,
} from "./dashboardAccess";

const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

function dash(id: string, extra: Partial<Dashboard> = {}): Dashboard {
  return {
    id,
    name: id,
    meta,
    appearance: { background: "transparent", gridBackground: "transparent" },
    layout: { lg: [], md: [], sm: [], xs: [] },
    ...extra,
  };
}

function state(items: Dashboard[], userId: string | null = "me"): RootState {
  return {
    dashboards: { items },
    auth: { currentUser: userId === null ? null : { id: userId } },
  } as unknown as RootState;
}

describe("dashboardAccessRole (HEL-1773 D3/D4)", () => {
  it("uses the server's accessRole when present, whatever the owner id says", () => {
    expect(dashboardAccessRole(dash("a", { accessRole: "viewer", ownerId: "me" }), "me")).toBe(
      "viewer",
    );
    expect(dashboardAccessRole(dash("a", { accessRole: "editor", ownerId: "x" }), "me")).toBe(
      "editor",
    );
    expect(dashboardAccessRole(dash("a", { accessRole: "owner", ownerId: "x" }), "me")).toBe(
      "owner",
    );
  });

  it("fails closed with no role: owner only when ownerId is the signed-in user", () => {
    expect(dashboardAccessRole(dash("a", { ownerId: "me" }), "me")).toBe("owner");
    expect(dashboardAccessRole(dash("a", { ownerId: "someone-else" }), "me")).toBe("viewer");
    expect(dashboardAccessRole(dash("a", { ownerId: "someone-else" }), null)).toBe("viewer");
  });

  it("treats a dashboard the store does not hold as a viewer", () => {
    expect(dashboardAccessRole(undefined, "me")).toBe("viewer");
    expect(selectDashboardAccessRole(state([]), "missing")).toBe("viewer");
    expect(selectDashboardAccessRole(state([]), null)).toBe("viewer");
  });
});

describe("role selectors", () => {
  const items = [
    dash("own", { accessRole: "owner" }),
    dash("ed", { accessRole: "editor" }),
    dash("vw", { accessRole: "viewer" }),
  ];

  it("derive edit and owner capabilities from the role", () => {
    const s = state(items);
    expect(selectCanEditDashboard(s, "own")).toBe(true);
    expect(selectCanEditDashboard(s, "ed")).toBe(true);
    expect(selectCanEditDashboard(s, "vw")).toBe(false);
    expect(selectIsDashboardOwner(s, "own")).toBe(true);
    expect(selectIsDashboardOwner(s, "ed")).toBe(false);
    expect(selectIsDashboardOwner(s, "vw")).toBe(false);
  });

  it("selectOwnedDashboards and isSharedDashboard agree: shared = not owned", () => {
    const s = state(items);
    expect(selectOwnedDashboards(s).map((d) => d.id)).toEqual(["own"]);
    expect(isSharedDashboard(items[1], "me")).toBe(true);
    expect(isSharedDashboard(items[0], "me")).toBe(false);
  });

  it("isKnownNonOwnedDashboard is false for a dashboard the store lacks and for a store with no dashboards slice", () => {
    expect(isKnownNonOwnedDashboard(state(items), "vw")).toBe(true);
    expect(isKnownNonOwnedDashboard(state(items), "own")).toBe(false);
    expect(isKnownNonOwnedDashboard(state(items), "missing")).toBe(false);
    expect(isKnownNonOwnedDashboard({} as RootState, "vw")).toBe(false);
  });
});
