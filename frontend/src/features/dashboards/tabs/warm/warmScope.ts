// HEL-1783 D3: which read route the caller's CURRENT role puts a dashboard on, for deciding whether a warm copy may be used.

import type { RootState } from "../../../../store/store";
import { dashboardAccessRole } from "../../state/dashboardAccess";

/** `output`: the Output routes (the caller owns it); `panel`: the per-panel routes (a viewer or editor grantee). */
export type WarmReadScope = "output" | "panel";

/** The caller's current scope for `dashboardId`, or `null` when the store does not hold the dashboard (the role is unknown, so
 *  no copy is used: `hydrateTabs` waits for the dashboard list before it restores anything, so this is rare). */
export function knownReadScope(state: RootState, dashboardId: string): WarmReadScope | null {
  const dashboard = state.dashboards?.items?.find((d) => d.id === dashboardId);
  if (dashboard === undefined) return null;
  return dashboardAccessRole(dashboard, state.auth?.currentUser?.id ?? null) === "owner"
    ? "output"
    : "panel";
}

/** What a copy or list entry carries: an absent scope (written before HEL-1783) reads as `output`. */
export function scopeOf(entry: { readScope?: WarmReadScope }): WarmReadScope {
  return entry.readScope ?? "output";
}
