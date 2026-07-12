- `frontend/src/features/dataTypes/types/dataType.ts` — added `isUnstructuredDataType(dt): boolean`
  helper checking `fields` (not `computedFields`) for `"string-body"` / `"binary-ref"`.
- `frontend/src/features/dataTypes/types/dataType.test.ts` — new unit tests for
  `isUnstructuredDataType` (string-body present, binary-ref present, all-structured, computed-field
  content type ignored).
- `frontend/src/shared/chrome/SidebarItemList.tsx` — exported `SidebarItem`, added optional
  `renderBadge?: (item: SidebarItem) => ReactNode` prop, rendered inline in a new
  `.dashboard-list__name-group` wrapper (both the `onSelect`/button and `toHref`/NavLink row
  variants) so the badge sits next to the name instead of being pushed to the far edge by
  `space-between`.
- `frontend/src/shared/chrome/SidebarBody.tsx` — registry branch now computes a
  `Set<string>` of unstructured DataType ids from the full `pipelineOutputDataTypes: DataType[]`
  list (via `isUnstructuredDataType`) and passes `renderBadge` to `SidebarItemList`, looking the
  row up by `item.id` against the set (no cast on `item`, per design.md's type-flow note).
  Sources/pipelines branches are unchanged (no `renderBadge` passed).
- `frontend/src/shared/chrome/SidebarBody.test.tsx` — new RTL tests: registry section shows the
  badge for a content-field DataType and not for a purely structured one; sources/pipelines
  sections render with no badge markup (regression check).
- `frontend/src/features/dashboards/ui/DashboardList.css` — added `.dashboard-list__name-group`
  (flex wrapper for name + badge, `min-width: 0` so ellipsis still works) and
  `.dashboard-list__badge` (pill recipe matching `.pipeline-status`: `--app-radius-pill`,
  `--text-xs`, `--weight-medium`, `--app-accent-surface` background / `--app-info` foreground per
  design.md Decision 3).

No backend files touched — no wire-shape or schema change (confirmed in design.md: per-field
`dataType` strings for content types are already on the wire).
