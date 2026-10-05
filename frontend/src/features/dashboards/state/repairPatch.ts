// The body of the owner's one-time stored-layout repair (HEL-1233): for every breakpoint whose
// STORED items are invalid (overlap / out of bounds, stale entries included — exactly what the
// server's LayoutValidator judges), the layout the user is already shown for it. Because the value
// is `resolveDashboardLayout`'s output, "stored after repair" equals "displayed before it" by
// construction. Breakpoints that are merely missing panels are valid and never included.

import { resolveDashboardLayout, dashboardGridCols } from "./dashboardLayout";
import { breakpointOrder, isLayoutValid } from "./breakpointLayout";
import type { DashboardLayout } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

export type DashboardLayoutRepairPatch = Partial<DashboardLayout>;

export function hasStoredBadBreakpoint(layout: DashboardLayout): boolean {
  return breakpointOrder.some((bp) => !isLayoutValid(layout[bp], dashboardGridCols[bp] ?? 0));
}

export function buildRepairPatch(
  panels: Panel[],
  layout: DashboardLayout,
): DashboardLayoutRepairPatch {
  const bad = breakpointOrder.filter(
    (bp) => !isLayoutValid(layout[bp], dashboardGridCols[bp] ?? 0),
  );
  if (bad.length === 0) return {};
  const resolved = resolveDashboardLayout(panels, layout);
  const patch: DashboardLayoutRepairPatch = {};
  for (const bp of bad) patch[bp] = resolved[bp];
  return patch;
}
