// hidesBreadcrumbItemName -- HEL-1579 (design.md D3, owner ruling `header-owns-name`) and HEL-1575 (D8):
// on a route whose page chrome already carries the item's name, the command bar's breadcrumb shows only
// the section label, so the name is not on screen twice. True on the rail shell's pipeline detail route
// (`/pipelines/:id`, the page header owns the name) and on the rail shell's dashboard view (the tab bar's
// active tab owns the name). The phone shell keeps its title block and switcher, so it never hides; the
// list route (`/pipelines`) has no item name to hide.
//
// One shared predicate on purpose: a route that needs the same treatment extends this function rather
// than adding a second competing conditional in `CommandBar.tsx`.

import { usesDashboardTabBar } from "./dashboardChrome";

const PIPELINE_DETAIL_PATH = /^\/pipelines\/[^/]+/;

export function hidesBreadcrumbItemName(pathname: string, isPhoneShell: boolean): boolean {
  if (isPhoneShell) return false;
  return PIPELINE_DETAIL_PATH.test(pathname) || usesDashboardTabBar(pathname, isPhoneShell);
}
