import type { RootState } from "../../../store/store";
import type { Dashboard, DashboardAccessRole } from "../types/dashboard";

// HEL-1773 -- the one place the client decides what the caller may do on a dashboard. Every gate in the shell reads
// these, never an ad-hoc `ownerId` comparison.
//
// Fail-closed: the effective role is the server's `accessRole` when present. When it is absent (a response that
// carried none and no earlier one was stored) the caller is the owner only if the dashboard's `ownerId` is the
// signed-in user; a different owner, or a dashboard the store does not hold, is a viewer. The one exception is an item
// with NEITHER a role NOR an owner: the server always sends `ownerId` (the type keeps it optional only for hand-built
// fixtures), so such an item never comes off the wire, and treating it as someone else's would hide every control in the
// many component tests that build a dashboard by hand.

/** The role a dashboard's caller holds, from the item alone and the signed-in user id. */
export function dashboardAccessRole(
  dashboard: Pick<Dashboard, "accessRole" | "ownerId"> | undefined,
  currentUserId: string | null | undefined,
): DashboardAccessRole {
  if (dashboard === undefined) return "viewer";
  if (dashboard.accessRole !== undefined) return dashboard.accessRole;
  if (dashboard.ownerId === undefined) return "owner";
  return dashboard.ownerId === currentUserId ? "owner" : "viewer";
}

export function selectDashboardAccessRole(
  state: RootState,
  dashboardId: string | null | undefined,
): DashboardAccessRole {
  const dashboard =
    dashboardId == null ? undefined : state.dashboards?.items?.find((d) => d.id === dashboardId);
  return dashboardAccessRole(dashboard, state.auth?.currentUser?.id ?? null);
}

/** Owner or editor: the roles the server lets change a dashboard's layout, name, appearance and panels. */
export function selectCanEditDashboard(
  state: RootState,
  dashboardId: string | null | undefined,
): boolean {
  const role = selectDashboardAccessRole(state, dashboardId);
  return role === "owner" || role === "editor";
}

/** Owner only: share, delete, duplicate, layout repair, folder moves, form submit, the Output routes. */
export function selectIsDashboardOwner(
  state: RootState,
  dashboardId: string | null | undefined,
): boolean {
  return selectDashboardAccessRole(state, dashboardId) === "owner";
}

/** The dashboards the user owns (an item with no role counts as owned only through the fail-closed rule). */
export function selectOwnedDashboards(state: RootState): Dashboard[] {
  const userId = state.auth?.currentUser?.id ?? null;
  return state.dashboards.items.filter((d) => dashboardAccessRole(d, userId) === "owner");
}

/** Shared with the user (editor or viewer): the items that carry the "Shared" marker. */
export function isSharedDashboard(
  dashboard: Pick<Dashboard, "accessRole" | "ownerId">,
  currentUserId: string | null | undefined,
): boolean {
  return dashboardAccessRole(dashboard, currentUserId) !== "owner";
}

/** True only for a dashboard that IS in the store and is not the caller's (the data-routing seams read this: which request
 *  an Output's rows and metadata go through, and whether a warm copy is kept). A dashboard the store does not hold cannot
 *  be displayed as someone else's, so for it the owner path (the pre-HEL-1773 behaviour) stays the default. */
export function isKnownNonOwnedDashboard(
  state: RootState,
  dashboardId: string | null | undefined,
): boolean {
  if (dashboardId == null) return false;
  // Optional chains: the data seams run in hosts whose store carries no dashboards or auth slice (a panels-only store).
  const dashboard = state.dashboards?.items?.find((d) => d.id === dashboardId);
  return (
    dashboard !== undefined &&
    dashboardAccessRole(dashboard, state.auth?.currentUser?.id ?? null) !== "owner"
  );
}
