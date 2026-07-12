## 1. Frontend

- [x] 1.1 Add `isUnstructuredDataType(dt: DataType): boolean` helper (checks `fields` for
      `dataType === "string-body" || dataType === "binary-ref"`; ignores `computedFields`).
- [x] 1.2 Add an optional `renderBadge?: (item: SidebarItem) => ReactNode` prop to
      `SidebarItemList` and render it inline next to `dashboard-list__name` when provided (wrap
      `dashboard-list__name` + badge in a nested flex span so `space-between` on
      `.dashboard-list__button` doesn't push the badge away from the name).
- [x] 1.3 In `SidebarBody.tsx`'s `registry` branch, compute a `Set<string>` of unstructured
      DataType ids by running `isUnstructuredDataType` over the full
      `pipelineOutputDataTypes: DataType[]` list (NOT inside the `renderBadge` callback — its
      `item` parameter is typed `SidebarItem` = `{id, name}` and has no `fields`), then have
      `renderBadge` look the row up by `item.id` against that set. No type assertion/cast on
      `item`.
- [x] 1.4 Add the badge markup + CSS following the `.pipeline-status` pill recipe
      (`--app-radius-pill`, `--text-xs`, `--weight-medium`, `--app-info` foreground /
      `--app-accent-surface` background) with an accessible name.

## 2. Tests

- [x] 2.1 Unit test `isUnstructuredDataType` (content field present/absent, computed-field-only
      case).
- [x] 2.2 Component/RTL test on the registry sidebar list: DataType with a content field renders
      the badge; a purely structured DataType does not.
- [x] 2.3 Regression check: sources/pipelines sidebar lists render unchanged (no `renderBadge`
      passed, no badge markup appears).
