// Client half of the layout-version precondition (HEL-1457). A layout save carries `expectedLayoutVersion`; the
// server answers 409 `{message, dashboard}` when another writer changed the layout first. The save is then rebased
// onto that fresh dashboard and retried once, so a concurrent panel placement is neither lost nor an error.

import { isAxiosError } from "axios";

import { dashboardGridCols } from "./dashboardLayout";
import { breakpointOrder, isLayoutValid } from "./breakpointLayout";
import type { Dashboard, DashboardLayout, DashboardLayoutItem } from "../types/dashboard";

export const LAYOUT_CONFLICT_MESSAGE =
  "This dashboard's layout was changed elsewhere; your last layout change was not saved.";

/** True for the server's 409 answer to a stale layout write. */
export function isLayoutConflict(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 409;
}

/** The current dashboard carried in a 409 body, or `null` when the body does not carry one. */
export function dashboardFromConflict(err: unknown): Dashboard | null {
  if (!isAxiosError(err)) return null;
  const body: unknown = err.response?.data;
  if (typeof body !== "object" || body === null || !("dashboard" in body)) return null;
  const { dashboard } = body as { dashboard: unknown };
  return typeof dashboard === "object" && dashboard !== null ? (dashboard as Dashboard) : null;
}

function sameGeometry(a: DashboardLayoutItem, b: DashboardLayoutItem | undefined): boolean {
  return b !== undefined && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/**
 * Reapplies the user's changes onto the fresh server layout, per breakpoint that was sent. An item the user
 * changed (sent differs from `base`, by panel id) comes from `sent`; every other panel comes from `fresh`, in
 * fresh's order; a panel absent from `fresh` is dropped. `null` when a rebased breakpoint is invalid, since the
 * server would refuse it: the caller then shows the fresh layout instead.
 */
export function rebaseLayoutPatch(
  sent: Partial<DashboardLayout>,
  base: DashboardLayout,
  fresh: DashboardLayout,
): Partial<DashboardLayout> | null {
  const rebased: Partial<DashboardLayout> = {};
  for (const bp of breakpointOrder) {
    const items = sent[bp];
    if (!items) continue;
    const baseById = new Map(base[bp].map((item) => [item.panelId, item]));
    const changed = new Map(
      items.filter((i) => !sameGeometry(i, baseById.get(i.panelId))).map((i) => [i.panelId, i]),
    );
    const next = fresh[bp].map((item) => changed.get(item.panelId) ?? item);
    if (!isLayoutValid(next, dashboardGridCols[bp] ?? 0)) return null;
    rebased[bp] = next;
  }
  return rebased;
}
