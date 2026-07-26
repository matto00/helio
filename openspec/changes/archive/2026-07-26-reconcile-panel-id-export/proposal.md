## Why

An agent reading a dashboard gets a panel's id under two different wire keys depending on
path: live `PanelResponse.id` vs. export-snapshot `DashboardSnapshotPanelEntry.snapshotId`.
Both are set from the same `panel.id.value` — same identity, different field name — but the
MCP `get_dashboard` tool (a thin passthrough of the export snapshot, since no authenticated
`GET /api/dashboards/:id/panels` exists) only ever surfaces `snapshotId`, forcing every
consumer (e.g. `helio-news`) to special-case `p.get("snapshotId") or p.get("id")`.

## What Changes

- Add an additive `id: Option[String]` field to `DashboardSnapshotPanelEntry`
  (`backend/.../DashboardProtocol.scala`), populated with the panel's real id on export.
  `snapshotId` is unchanged and remains the import-remap handle.
- Import (`DashboardSnapshotRepository`, `DashboardServiceValidation`) keeps keying off
  `snapshotId` only; `id` is decode-tolerant (`Option`) so pre-existing exported JSON files
  (which lack `id`) still import cleanly. No version bump — this is non-breaking additive.
- Mirror the field in `helio-mcp/src/types.ts` (`SnapshotPanelEntry.id?`) and the frontend
  snapshot type (`DashboardSnapshotPanelEntry.id?`) — both are pass-through consumers of the
  same wire shape, no logic changes needed since `get_dashboard` already spreads
  `snapshot.panels` verbatim.
- Update the `get_dashboard` MCP tool description to state each panel carries a stable `id`.
- Update `openspec/specs/dashboard-export-import/spec.md` (delta): document the new `id`
  field and narrow the existing "SHALL NOT include server-assigned IDs" line to state the
  panel `id` is an intentional, additive exception for programmatic identification.
- No `schemas/` file exists for the export/snapshot wire shape today (none of
  `schemas/*.schema.json` cover it, and `check-schema-drift.mjs` does not track this class),
  so none is added — consistent with existing convention.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `dashboard-export-import`: export panel entries additionally carry a stable `id` field
  (the real, non-remapped panel id), alongside the unchanged `snapshotId` remap handle.

## Impact

- Backend: `DashboardProtocol.scala` (wire shape + format), `DashboardSnapshotRepository`
  (verify unaffected — still reads `snapshotId`), `DashboardServiceValidation` (verify
  unaffected), backend export/import tests.
- Frontend: `dashboard.ts` type only (no behavioral change — export/import is pass-through
  file download/upload).
- `helio-mcp`: `types.ts` (`SnapshotPanelEntry`), `tools/read.ts` (tool description text).
- `helio-news`'s `p.get("snapshotId") or p.get("id")` simplification is a separate repo
  (out of this monorepo) — filed as a spinoff ticket, not touched here.

## Non-goals

- No new `GET /api/dashboards/:id` or `/:id/panels` endpoint (explicitly out of scope per
  ticket).
- No change to import remap semantics or `snapshotId`'s role there.
- No absorption of HEL-369 (external-run hooks) or HEL-624 (pie/scatter aggregation).
