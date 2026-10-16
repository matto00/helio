// "Tidy layout" (HEL-1576 design D8): the pure compaction behind the edit-mode action. A thin wrapper
// over `compactLayout` that adds the authored-layout rule; it never writes anything itself.

import type { Panel } from "../../panels/types/panel";
import type { DashboardLayout, DashboardLayoutItem } from "../types/dashboard";
import { compactLayout, isItemInBounds } from "./breakpointLayout";
import { areDashboardLayoutsEqual, dashboardGridCols, liveEntries } from "./dashboardLayout";

const breakpoints = ["lg", "md", "sm", "xs"] as const;

/** One breakpoint's stored items with the live entries compacted upward. A breakpoint with no live
 *  entries, or whose live entries sit outside the column bounds (the resolver treats it as unauthored
 *  and derives every position), is returned as stored. Stored items that are not live entries (panels
 *  this tab has not loaded, duplicates, blank ids) are kept verbatim, and no entry is ever added, so a
 *  partially authored breakpoint never has a derived position written into it. */
function tidyBreakpoint(
  stored: readonly DashboardLayoutItem[],
  liveIds: Set<string>,
  cols: number,
): DashboardLayoutItem[] {
  const entries = liveEntries([...stored], liveIds);
  if (entries.length === 0 || !entries.every((item) => isItemInBounds(item, cols))) {
    return [...stored];
  }
  const tidied = new Map(compactLayout(entries, cols).map((item) => [item.panelId, item]));
  const consumed = new Set<string>();
  return stored.map((item) => {
    const moved = tidied.get(item.panelId);
    if (!moved || consumed.has(item.panelId)) return item;
    consumed.add(item.panelId);
    return moved.y === item.y ? item : { ...item, y: moved.y };
  });
}

/** The dashboard's authored `layout` with every breakpoint tidied per `tidyBreakpoint`. Returns the
 *  input object itself when no stored entry would move, so callers can detect "nothing to tidy" by
 *  identity or with `areDashboardLayoutsEqual`. */
export function tidyLayout(layout: DashboardLayout, panels: readonly Panel[]): DashboardLayout {
  const liveIds = new Set(panels.map((panel) => panel.id));
  const next = {} as DashboardLayout;
  for (const bp of breakpoints)
    next[bp] = tidyBreakpoint(layout[bp], liveIds, dashboardGridCols[bp]);
  return areDashboardLayoutsEqual(next, layout) ? layout : next;
}
