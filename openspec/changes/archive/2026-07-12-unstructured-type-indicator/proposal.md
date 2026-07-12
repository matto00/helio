## Why

HEL-217 added content field types (`string-body`, `binary-ref`) and the v1.4 connectors
(HEL-214/215/216) now produce DataTypes built from them, but the Type Registry list gives no
visual signal that a type is content-backed vs. a plain structured type. This is the final ticket
of the v1.4 Unstructured Data epic (HEL-147) — without it, unstructured types are indistinguishable
from structured ones at a glance.

## What Changes

- Type Registry sidebar list (`SidebarItemList` in the `registry` section) renders a small badge
  next to any DataType that has at least one content field (`string-body` or `binary-ref`).
- `SidebarItemList` gains an optional, generic per-item badge render slot so the registry section
  can opt in without affecting the sources/pipelines sections that reuse the same component.
- A pure helper classifies a `DataType` as unstructured by inspecting `fields[].dataType` for the
  two content wire values — no backend or wire-shape change: `DataFieldResponse.dataType` already
  carries `"string-body"` / `"binary-ref"` today (confirmed in `DataTypeProtocol.scala`).
- Badge visual reuses the existing pill-badge recipe (`.pipeline-status` in
  `PipelinesPage.css`) per DESIGN.md's "reuse, don't reinvent" rule — no new visual language.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `type-registry-content-fields`: adds a requirement that the Type Registry list view visually
  distinguishes DataTypes with content fields from purely structured DataTypes.

## Impact

- `frontend/src/shared/chrome/SidebarItemList.tsx` — add optional badge render prop.
- `frontend/src/shared/chrome/SidebarBody.tsx` — pass the badge renderer for the `registry`
  section only.
- `frontend/src/features/dataTypes/types/dataType.ts` (or a small colocated util) — add the
  unstructured-classification helper.
- New/updated CSS for the badge, following the `.pipeline-status` pill recipe and DESIGN.md
  tokens (`--app-radius-pill`, `--text-xs`, `--weight-medium`, intent color).
- No backend change, no Flyway migration (confirmed: wire shape already exposes per-field
  `dataType` strings for content types).

## Non-goals

- No change to `TypeDetailPanel` (already lists `string-body`/`binary-ref` as field-type options
  per HEL-217).
- No new shared `Badge` component — reuses the existing local pill-badge pattern.
- No filtering/sorting of the registry list by structured/unstructured — indicator only.
