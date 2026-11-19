import type { Dashboard } from "../features/dashboards/types/dashboard";

// HEL-1780 D1 -- `panelReadScopeFor` is fail-closed: a panel whose dashboard the store does not hold reads through the
// per-panel routes. A test of the OWNER path (the Output routes) therefore seeds the panel's dashboard as owned, here,
// explicitly. `renderWithStore` deliberately does not do it for the caller, so the fail-closed rule stays observable.

export const OWNED_DASHBOARD_ID = "dash-1";

const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

/** A dashboard item the caller owns (`accessRole: "owner"`). */
export function ownedDashboard(id: string = OWNED_DASHBOARD_ID): Dashboard {
  return {
    id,
    name: id,
    meta,
    appearance: { background: "transparent", gridBackground: "transparent" },
    layout: { lg: [], md: [], sm: [], xs: [] },
    accessRole: "owner",
  };
}

/** Seeds an owned dashboard into a store that carries the `dashboards` reducer. */
export function seedOwnedDashboard(
  store: { dispatch: (action: never) => unknown },
  id: string = OWNED_DASHBOARD_ID,
): void {
  store.dispatch({
    type: "dashboards/fetchDashboards/fulfilled",
    payload: [ownedDashboard(id)],
  } as never);
}

// A component test through `renderWithStore` declares, once per file, which dashboards the panels it renders belong to and
// that the caller owns them. The declaration is explicit and file-scoped (cleared after each test), so a file that does
// not make it keeps the fail-closed behaviour.
let declaredOwnedIds: string[] = [];

/** Ids declared owned for the current test by `ownDashboardsInThisFile`. */
export function declaredOwnedDashboardIds(): readonly string[] {
  return declaredOwnedIds;
}

/** Call at the top level of a test file: every `renderWithStore` in it seeds these dashboards as owned. */
export function ownDashboardsInThisFile(...ids: string[]): void {
  beforeEach(() => {
    declaredOwnedIds = ids;
  });
  afterEach(() => {
    declaredOwnedIds = [];
  });
}

/** A `dashboards` slice state holding these dashboards as owned, for `configureStore({ preloadedState })` in a test that
 *  builds its own store (pair it with `dashboards: dashboardsReducer`). */
export function ownedDashboardsState(...ids: string[]) {
  return {
    items: (ids.length > 0 ? ids : [OWNED_DASHBOARD_ID]).map((id) => ownedDashboard(id)),
    selectedDashboardId: null,
    status: "succeeded" as const,
    error: null,
    hasPendingLayout: false,
    layoutSaveSeq: 0,
  };
}
