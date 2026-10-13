// Builds the body of a layout PATCH (HEL-1071). The server rejects (400) a breakpoint that differs from
// what it stored and is out of bounds or overlapping, so the client must never send one: it sends ONLY
// the breakpoints that changed since the last server-acknowledged layout, and replaces a changed-and-
// invalid breakpoint with the layout the user actually sees (the render-time resolution, HEL-1023).

import { areBreakpointLayoutsEqual, dashboardGridCols } from "./dashboardLayout";
import { breakpointOrder, isLayoutValid } from "./breakpointLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";

export type DashboardLayoutPatch = Partial<DashboardLayout>;

/**
 * HEL-1527: the authored items of panels the resolution does not cover (panels this tab has not loaded).
 * They are sent as authored, never judged here: the server drops a deleted panel's item and rejects an
 * overlap with a live one. Blank and repeated ids are skipped, as `resolveDashboardLayout` does.
 */
function unloadedItems(
  authored: DashboardLayoutItem[],
  resolved: DashboardLayoutItem[],
): DashboardLayoutItem[] {
  const seen = new Set(resolved.map((item) => item.panelId));
  const kept: DashboardLayoutItem[] = [];
  for (const item of authored) {
    if (item.panelId.trim().length === 0 || seen.has(item.panelId)) continue;
    seen.add(item.panelId);
    kept.push(item);
  }
  return kept;
}

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
    patch[bp] =
      resolved && !isLayoutValid(next[bp], cols)
        ? [...resolved[bp], ...unloadedItems(next[bp], resolved[bp])]
        : next[bp];
  }
  return patch;
}
