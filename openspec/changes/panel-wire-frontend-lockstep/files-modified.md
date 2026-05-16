# Files modified — CS2c-3c cycle 1

Backend wire-shape collapse + JSON Schemas. Frontend lockstep DEFERRED — see
executor-report-1.md "BLOCKER" section.

## Backend — domain panels (per-subtype Patch decoders + applyPatch)

- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala` — added `Patch` ADT + `decodeCreate` + `applyPatch`
- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala` — same
- `backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala` — Patch with `imageFit` allow-list validation at decode time
- `backend/src/main/scala/com/helio/domain/panels/DividerPanel.scala` — Patch with `orientation` allow-list validation at decode time
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — NEW — single dispatcher between wire `(type, config)` and typed ADT

## Backend — protocol / service / repository (write + read path)

- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala` — `PanelResponse` / `CreatePanelRequest` / `UpdatePanelRequest` / `PanelBatchItem` collapsed to `type` + typed `config`
- `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` — `DashboardSnapshotPanelEntry` collapsed to `type` + typed `config`; added `DashboardSnapshotPayload.CurrentVersion = 2`
- `backend/src/main/scala/com/helio/services/PanelService.scala` — `resolvePatch` enforces cross-type 400 lock; `resolveCreateConfig` decodes typed create payload; `buildNewPanel` dispatches per-subtype CreateConfig
- `backend/src/main/scala/com/helio/services/PanelPatchApplier.scala` — rewritten to apply title → appearance → typed config (via `PanelConfigCodec.applyConfigPatch`)
- `backend/src/main/scala/com/helio/services/DashboardService.scala` — snapshot validation rejects prior version with descriptive error; validates each entry's typed config
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — added `replace(panel, lastUpdated)` for typed-config writeback; `batchUpdate` consumes typed `config` patch
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — import path reconstructs Panel via `PanelConfigCodec.decodeCreateConfig`; export tags `CurrentVersion`

## Backend — tests

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — updated all `CreatePanelRequest`, `UpdatePanelRequest`, `PanelBatchItem`, `DashboardSnapshotPanelEntry` to the new wire shape; switched flat-field assertions to `config.asJsObject.fields(...)` reads; `snapshot.version` now compared to `CurrentVersion`
- `backend/src/test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala` — `PanelResponse` and `DashboardSnapshotPayload` round-trips updated for the new shape
- `backend/src/test/scala/com/helio/services/DashboardSnapshotValidationSpec.scala` — rewrote the version-rejection case (now rejects prior versions, not `< 1`); uses `JsObject.empty` for entry configs

## Schemas

- `schemas/panel.schema.json` — `oneOf` discriminator + per-subtype `$defs` (MetricConfig / ChartConfig / TableConfig / TextConfig / MarkdownConfig / ImageConfig / DividerConfig)
- `schemas/create-panel-request.schema.json` — `allOf` + `if/then` over `type` to select the matching `$ref` config shape
- `schemas/update-panels-batch-request.schema.json` — entry shape gains `config` typed payload

## OpenSpec change folder

- `openspec/changes/panel-wire-frontend-lockstep/{ticket.md,proposal.md,design.md,tasks.md,workflow-state.md,.openspec.yaml,specs/*/spec.md}` — planning artifacts
