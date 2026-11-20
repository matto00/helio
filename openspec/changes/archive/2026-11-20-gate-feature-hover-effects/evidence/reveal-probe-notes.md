# Reveal render-site probe (task 1.5), unchanged CSS

Inventory (`inventory-main.txt`, tag NON-FILL): the only non-fill ungated rule outside `PIPELINE_GUARDED_FILES` is
`features/dashboards/ui/DashboardList.css` `.dashboard-list__item-row:hover .popover.actions-menu` (mixed with
`:focus-within` and `:has(.actions-menu__trigger[aria-expanded="true"])`). The other two NON-FILL rows are the already
allowlisted `PipelineSpine.css` reveals.

Premise correction (design.md D3 said two render sites): the Assistant conversation rows (`AssistantContextList` ->
`SidebarItemList`) pass no `onDelete`, so they render no `.popover.actions-menu`; their Rename / Pin are plain
`dashboard-list__row-action-btn` buttons, 24px wide. The reveal rule therefore has ONE render site, the dashboards list
row (`DashboardList.tsx:441`). No site lacks a touch path, so no escalation; the allowlist reason names only DashboardList.

Probe (touch tablet 1024x768, `e2e/hel1735-feature-hover.spec.ts` "row actions reveal"), see `e2e-red-run-main-css.txt`:
- dashboard row: trigger 3x24 before the tap, 24x24 after a tap on the row (focus-within reveal), popover clip `auto`,
  and a tap on the trigger opens the menu: reachable.
- assistant conversation row: 0 actions-menu popovers, both row-action buttons 24px wide: nothing hidden.
