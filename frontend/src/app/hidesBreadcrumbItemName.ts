// hidesBreadcrumbItemName -- HEL-1579 (design.md D3, owner ruling `header-owns-name`): on a route whose
// page header already carries the item's name, the command bar's breadcrumb shows only the section
// label, so the name is not on screen twice. True only for the rail shell's pipeline detail route
// (`/pipelines/:id`); the phone shell keeps its title block, and the list route (`/pipelines`) has
// no item name to hide.
//
// One shared predicate on purpose: HEL-1575 hides the dashboard name on the rail-shell dashboard
// view the same way. Whichever lane merges second extends this function with its own route rather
// than adding a second competing conditional in `CommandBar.tsx`.

const PIPELINE_DETAIL_PATH = /^\/pipelines\/[^/]+/;

export function hidesBreadcrumbItemName(pathname: string, isPhoneShell: boolean): boolean {
  if (isPhoneShell) return false;
  return PIPELINE_DETAIL_PATH.test(pathname);
}
