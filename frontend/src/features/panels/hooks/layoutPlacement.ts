import { areBreakpointLayoutsEqual } from "../../dashboards/state/dashboardLayout";
import { breakpointOrder } from "../../dashboards/state/breakpointLayout";
import type { DashboardLayout, DashboardLayoutItem } from "../../dashboards/types/dashboard";

type Appended = Record<(typeof breakpointOrder)[number], DashboardLayoutItem[]>;

/**
 * HEL-1230 (D4): the items a panel create appended, or `null` when `next` is not a pure placement.
 * True only when, in EVERY breakpoint, `next` is `prev` as an exact prefix followed by items whose
 * `panelId` appears in no breakpoint of `prev`, and at least one item was appended overall. A
 * reorder, move, removal or server layout that also moved existing items never matches.
 */
export function detectPlacementExtension(
  prev: DashboardLayout,
  next: DashboardLayout,
): Appended | null {
  const knownIds = new Set(breakpointOrder.flatMap((bp) => prev[bp].map((i) => i.panelId)));
  const appended = {} as Appended;
  let total = 0;
  for (const bp of breakpointOrder) {
    const before = prev[bp];
    if (next[bp].length < before.length) return null;
    if (!areBreakpointLayoutsEqual(next[bp].slice(0, before.length), before)) return null;
    const added = next[bp].slice(before.length);
    if (added.some((item) => knownIds.has(item.panelId))) return null;
    appended[bp] = added;
    total += added.length;
  }
  return total > 0 ? appended : null;
}

/** The baseline plus the appended placements (skipping ids it already holds). */
export function extendBaseline(baseline: DashboardLayout, appended: Appended): DashboardLayout {
  const extended = { ...baseline };
  for (const bp of breakpointOrder) {
    const held = new Set(baseline[bp].map((i) => i.panelId));
    extended[bp] = [...baseline[bp], ...appended[bp].filter((i) => !held.has(i.panelId))];
  }
  return extended;
}
