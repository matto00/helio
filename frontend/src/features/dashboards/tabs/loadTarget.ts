// HEL-1624: the one rule for "which dashboard does a load select". `fetchDashboards` applies it when the list arrives, so the
// selection goes straight from null to the target, and `planHydration` applies the same rule later, so hydration's own
// selection write is a no-op write of the same value. Imports only `tabTypes.ts`: `hydrateTabs.ts` imports the dashboards slice,
// so the slice must never import from it.

import { parseInstant, type DashboardTab, type normalizeSavedTabs } from "./tabTypes";

/** `/dashboards/:id` (the authenticated route, HEL-1209) -> `:id`; anything else -> null. The public viewer is the longer
 *  `/dashboards/:id/panels` and is deliberately not matched. */
export function deepLinkDashboardId(pathname: string): string | null {
  const match = /^\/dashboards\/([^/]+)\/?$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function mostRecentlyViewed(tabs: DashboardTab[]): DashboardTab {
  return tabs.reduce((best, tab) =>
    (parseInstant(tab.lastViewedAt) ?? -Infinity) > (parseInstant(best.lastViewedAt) ?? -Infinity)
      ? tab
      : best,
  );
}

type SavedTabs = ReturnType<typeof normalizeSavedTabs>;

/** The saved tabs that still exist (duplicates dropped) and the saved active tab when it survives. */
export function pruneSavedTabs(
  saved: SavedTabs,
  dashboardIds: Set<string>,
): { tabs: DashboardTab[]; savedActive: string | null } {
  const seen = new Set<string>();
  const tabs = (saved?.tabs ?? []).filter((tab) => {
    if (!dashboardIds.has(tab.id) || seen.has(tab.id)) return false;
    seen.add(tab.id);
    return true;
  });
  const savedActive = saved?.activeId && seen.has(saved.activeId) ? saved.activeId : null;
  return { tabs, savedActive };
}

/** The target: a deep link > the saved active tab > (a stored empty set stays empty) > the most recently viewed surviving tab >
 *  the auto-selection (the landing default). */
export function resolveLoadTarget(args: {
  saved: SavedTabs;
  dashboardIds: Set<string>;
  autoSelectedId: string | null;
  deepLinkId: string | null;
}): string | null {
  const { saved, dashboardIds, autoSelectedId, deepLinkId } = args;
  const { tabs, savedActive } = pruneSavedTabs(saved, dashboardIds);
  if (deepLinkId !== null && dashboardIds.has(deepLinkId)) return deepLinkId;
  if (savedActive !== null) return savedActive;
  if (saved !== null && saved.tabs.length === 0) return null;
  if (tabs.length > 0) return mostRecentlyViewed(tabs).id;
  return autoSelectedId;
}
