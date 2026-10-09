## Why

The Output editor sheet's edit-mode Save rebuilds the whole kind config from editor state and PATCHes it. `PATCH /api/outputs/:id` shallow-merges `config` (top-level keys replace whole, an omitted key is kept, an explicit `null` is stored as `null`). Against those semantics the current client both clobbers and fails to clear (see ticket.md, HEL-1389, follow-up of HEL-1313):

- Collection `layout` and timeline `sort` are hard-coded to `"grid"`/`"asc"` on every save, overwriting a stored `"list"`/`"desc"` the editor never shows.
- Switching a metric Label/Unit from a literal to a field binding sends the literal key as *omitted* (`undefined`), so the stored literal survives and keeps rendering. (Emptying a literal sends `""`, which already renders nothing; that path is a consistency fix, not the bug.)
- Restoring a table's columns to natural, all-visible order sends `columnOrder` as omitted, so the stored order (and any hidden columns) survives.
- The chart's base `fieldMapping` is the stored one, `annotation` key included, so removing/switching the annotation binding leaves a stale `fieldMapping.annotation` behind — and Outputs already damaged this way (literal annotation + stale mapping, or literal metric label + stale `fieldMapping.label`) can never be repaired through the editor.

## What Changes

- Edit-mode Save sends a config **patch**: only top-level keys whose value the user changed relative to what the editor opened with; if nothing changed, `config` is omitted from the request entirely. Keys the editor does not own (collection `layout`, timeline `sort`, table `columnSort`/`columnFilters`/`pinnedColumns`, `historyPayloads` unless toggled, any other stored key) are never sent, so the server's shallow merge preserves them byte-for-byte.
- Clears are explicit `null`: metric `label`/`unit` when switched to field mode or emptied; table `columnOrder` when every column is visible in natural order; chart `annotation` when the literal is emptied.
- Hidden table columns are persisted even without a reorder (a visible subset is always written as an explicit `columnOrder` array), in create and edit.
- Chart/metric `fieldMapping` never carries a slot key (`annotation`, `label`, `unit`) the current editor state does not bind; a save of an Output whose stored `fieldMapping` carries such a stale slot sends the repaired `fieldMapping` (deliberate, narrow exception for a key the editor owns).
- Create-mode Save keeps sending full config, including `layout: "grid"` / `sort: "asc"` defaults.
- No backend production change. A backend guard test pins the merge semantics the client relies on.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: adds a requirement that the edit-mode Save preserves untouched stored config and expresses clears explicitly.

## Impact

- Frontend: `frontend/src/features/pipelines/ui/outputEditor/` (`buildOutputConfig.ts`, `OutputEditorSheet.tsx`, `useOutputTableColumns.ts`, a small diff helper) plus tests.
- Backend: test-only guard.
- Related, not absorbed: HEL-1388 (Kind select editable in edit mode); HEL-1394 (Inspect grid column order — Backlog, unimplemented; today with no `columnOrder` both the table and Inspect grid use row-key order).
