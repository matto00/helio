// Dashboard-view chrome decisions, in one place. The rail shell's dashboard view carries two pieces of
// chrome that share one condition: HEL-1576's dashboard meta row takes the command bar's slot (design.md D1,
// owner answer `meta-row-replaces-command-bar`), and HEL-1575's tab bar is the first row of the content
// column (D8). Every other page, and the phone shell everywhere, keeps the command bar and no tab bar.
//
// Both are composed from `isDashboardViewPath` on purpose (no route literal of their own), so a move of the
// dashboard view to another path (HEL-1578) flows through automatically. A third piece of chrome with the
// same condition extends `isRailDashboardView` instead of adding a parallel conditional in `App.tsx`.

import { isDashboardViewPath } from "../shared/chrome/sections";

function isRailDashboardView(pathname: string, isPhoneShell: boolean): boolean {
  return !isPhoneShell && isDashboardViewPath(pathname);
}

/** The dashboard meta row replaces the command bar. */
export function usesDashboardMetaRow(pathname: string, isPhoneShell: boolean): boolean {
  return isRailDashboardView(pathname, isPhoneShell);
}

/** The persistent dashboard tab bar is mounted. */
export function usesDashboardTabBar(pathname: string, isPhoneShell: boolean): boolean {
  return isRailDashboardView(pathname, isPhoneShell);
}
