// usesDashboardMetaRow -- HEL-1576 (design.md D1, owner answer `meta-row-replaces-command-bar`): on the
// rail shell's dashboard view the dashboard meta row takes the command bar's slot; every other page, and
// the phone shell everywhere, keeps the command bar. The one place that decision is expressed.
//
// Composed from `isDashboardViewPath` on purpose (no route literal of its own), so a move of the
// dashboard view to another path (HEL-1578) flows through automatically.

import { isDashboardViewPath } from "../shared/chrome/sections";

export function usesDashboardMetaRow(pathname: string, isPhoneShell: boolean): boolean {
  return !isPhoneShell && isDashboardViewPath(pathname);
}
