## Why

CS2c-3b landed the backend Panel typed ADT with the wire shape PRESERVED by two pattern-matching adapters
(`PanelResponse.fromDomain` and `DashboardSnapshotPanelEntry.fromDomain`) plus three flat-field write-path
types (`CreatePanelRequest`, `UpdatePanelRequest`, `PanelBatchItem`). The wide-flat wire is the last place
the seven-subtype enumeration still leaks across the system. CS2c-3c is the final HEL-236 sub-PR: it collapses
both the read and write paths to a `type` + typed `config` wire, migrates the frontend in lockstep to a
discriminated union, updates the schemas, bumps the snapshot version, and closes the pre-existing Image /
Divider snapshot data-loss bug.

## What Changes

- **BREAKING** Panel wire shape: read-side `PanelResponse` and `DashboardSnapshotPanelEntry` emit
  `type` discriminator + typed `config` payload; per-subtype flat nullable fields removed at the wire root.
- **BREAKING** Panel write shape: `CreatePanelRequest`, `UpdatePanelRequest`, and `PanelBatchItem` move
  to `type` + typed `config` with absent-vs-null preserved per config field; `PanelService.create` /
  `PanelService.update` / batch-update dispatch on the discriminator and preserve the cross-type PATCH 400 lock.
- **BREAKING** Dashboard snapshot version bump; importer behavior for older versions documented in design.md.
  Image / Divider fields now survive export → import.
- Companion per-subtype request decoders under `domain/panels/` round-trip and accept partial configs
  (`decode("{}")` succeeds with defaults — codec read-path tolerance rule from CS2c-2/3a/3b).
- Frontend `Panel` becomes a discriminated union over 7 subtypes (Metric, Chart, Table, Text, Markdown,
  Image, Divider); all ~21 consumer sites migrate from flat nullable reads to narrowing.
- Panel JSON Schemas (flat `schemas/*.json`) evolve in place to discriminated-union shape.
- Frontend file-size BLOCKER triage: `PanelGrid.tsx` (597L), `PanelDetailModal.tsx` (1021L),
  `panelsSlice.ts` (439L), and `models.ts` (587L) all exceed budget; per-subtype dispatch lands via
  extractions, never by adding code to already-over-budget files.

## Capabilities

### New Capabilities

(none — this is a wire-shape and structural migration; no new behavior is introduced)

### Modified Capabilities

- `panel-type-rendering`: Panel responses use `type` + typed `config` discriminated wire; frontend renderers
  dispatch on the union; Image and Divider config round-trip through snapshot export/import.
- `panel-type-field`: Create/update request shapes carry `type` + typed `config` instead of flat per-subtype
  nullable fields; cross-type PATCH continues to reject at 400.
- `panel-batch-update`: Batch items carry `type` + typed `config` mirroring the single-update shape.
- `dashboard-export-import`: Snapshot wire version bumps; Image / Divider config fields are preserved on
  round-trip (closes pre-existing data-loss bug); importer policy for the prior version is documented.

## Impact

- **Code**:
  - Backend: `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` (read + write types
    and formats), `DashboardSnapshotPanelEntry` (read path + bug fix), `PanelService` (write-path
    dispatch), companion request decoders under `backend/src/main/scala/com/helio/domain/panels/`,
    snapshot version constant.
  - Frontend: `frontend/src/types/models.ts` (union), `PanelGrid.tsx`, `PanelDetailModal.tsx`,
    `panelsSlice.ts`, `panelsService.ts`, ~21 consumer call sites; per-subtype editor / renderer
    extractions to stay within file-size budgets.
  - Schemas: `schemas/panel.schema.json`, `schemas/create-panel-request.schema.json`,
    `schemas/update-panels-batch-request.schema.json`, `schemas/update-panels-batch-response.schema.json`
    (in-place evolution; flat layout preserved).
- **APIs**: BREAKING — `GET /api/panels`, `GET /api/dashboards/:id/panels`, `POST /api/panels`,
  `PATCH /api/panels/:id`, `PATCH /api/panels/batch`, `GET /api/dashboards/:id/export`,
  `POST /api/dashboards/import`. No URL changes; payload shapes change.
- **Dependencies**: none added.
- **Systems**: snapshot persistence — older exported snapshots become read-only via importer-version
  handling (covered in design.md); live DB rows are unaffected (the domain ADT already exists).

## Non-goals

- HEL-242 (P0 panel-binding bug) stays DEFERRED. CS2c-3c must not regress it but must not attempt the fix.
- `useLegacyBoundPanel` hook (pre-Pipeline DataType binding) is preserved as-is; removal is a CS3-era cleanup.
- `appearance.chart` migration into `ChartPanelConfig` is a spinoff, not in scope.
- AuthService untouched (security-sensitive).
