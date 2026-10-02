// Builds the body of a layout PATCH (HEL-1071). The server rejects (400) a breakpoint that differs from
// what it stored and is out of bounds or overlapping, so the client must never send one: it sends ONLY
// the breakpoints that changed since the last server-acknowledged layout, and replaces a changed-and-
// invalid breakpoint with the layout the user actually sees (the render-time resolution, HEL-1023).

import { areBreakpointLayoutsEqual, dashboardGridCols } from "./dashboardLayout";
import { breakpointOrder, isLayoutValid } from "./breakpointLayout";
import type { DashboardLayout } from "../types/dashboard";

export type DashboardLayoutPatch = Partial<DashboardLayout>;

/**
 * @param next      the latest authored layout
 * @param baseline  the last layout the server acknowledged
 * @param resolved  the resolution of `next` against the loaded panels, or `null` when the panels are
 *                  not loaded for this dashboard: an empty/stale panel list would resolve to an empty
 *                  (valid) breakpoint and wipe stored items, so nothing is substituted then.
 */
export function buildLayoutPatch(
  next: DashboardLayout,
  baseline: DashboardLayout,
  resolved: DashboardLayout | null,
): DashboardLayoutPatch {
  const patch: DashboardLayoutPatch = {};
  for (const bp of breakpointOrder) {
    if (areBreakpointLayoutsEqual(next[bp], baseline[bp])) continue;
    const cols = dashboardGridCols[bp] ?? 0;
    patch[bp] = resolved && !isLayoutValid(next[bp], cols) ? resolved[bp] : next[bp];
  }
  return patch;
}
