// The body of the owner's one-time stored-layout repair (HEL-1233, widened by HEL-1260). A breakpoint
// is repairable when it is stored-bad (overlap / out of bounds, stale entries included — exactly what
// the server's LayoutValidator judges) or incomplete (valid, but some live panel has no item; an empty
// breakpoint with live panels counts). For each repairable breakpoint the patch carries the layout the
// user is already shown for it. Because the value is `resolveDashboardLayout`'s output, "stored after
// repair" equals "displayed before it" by construction. For an incomplete breakpoint `resolve` keeps
// every stored live item exactly where it is stored and only adds the missing panels, which is the
// append-only shape the server requires. A complete valid breakpoint is never included.

import { resolveDashboardLayout, dashboardGridCols } from "./dashboardLayout";
import { breakpointOrder, isLayoutValid, type BreakpointKey } from "./breakpointLayout";
import type { DashboardLayout } from "../types/dashboard";
import type { Panel } from "../../panels/types/panel";

export type DashboardLayoutRepairPatch = Partial<DashboardLayout>;

function repairableBreakpoints(panels: Panel[], layout: DashboardLayout): BreakpointKey[] {
  return breakpointOrder.filter((bp) => {
    const items = layout[bp];
    if (!isLayoutValid(items, dashboardGridCols[bp] ?? 0)) return true;
    const held = new Set(items.map((item) => item.panelId));
    return panels.some((panel) => !held.has(panel.id));
  });
}

export function hasRepairableBreakpoint(panels: Panel[], layout: DashboardLayout): boolean {
  return repairableBreakpoints(panels, layout).length > 0;
}

export function buildRepairPatch(
  panels: Panel[],
  layout: DashboardLayout,
): DashboardLayoutRepairPatch {
  const repairable = repairableBreakpoints(panels, layout);
  if (repairable.length === 0) return {};
  const resolved = resolveDashboardLayout(panels, layout);
  const patch: DashboardLayoutRepairPatch = {};
  for (const bp of repairable) patch[bp] = resolved[bp];
  return patch;
}
