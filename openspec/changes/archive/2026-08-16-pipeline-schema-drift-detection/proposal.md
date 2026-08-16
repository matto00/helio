# Pipeline schema-drift detection (HEL-462)

## Why

A pipeline's source columns can change out from under it (a CSV re-uploaded with a renamed/removed column, a
REST payload that drops a field). Nothing detects this today: the pipeline silently produces a different-shaped
output and downstream panels/metrics break with no signal. This change captures a source-schema baseline on each
successful run and reports drift against it at analyze time.

## What Changes

- Flyway migration (V85 at branch time — re-verified against origin/main before delivery) adds a nullable
  `last_source_schema JSONB` column to `pipelines`, following the additive-nullable precedent of
  `V53__panel_column_widths.sql`.
- `PipelineRunService.onRunSuccess` persists the pipeline's current source schema (same derivation the analyze
  path uses) alongside the existing `updateLastRun` — best-effort, never failing the run.
- New pure drift-diff helper returning `addedColumns`, `removedColumns`, `typeChangedColumns`.
- `GET /api/pipelines/:id/analyze` response gains an optional `sourceSchemaDrift` object, computed at analyze
  time; absent when there is no baseline (never a successful run) or no drift.
- `schemas/pipeline-analyze-response.schema.json` updated (optional property — not added to `required`).

## Capabilities

### New Capabilities

- `pipeline-schema-drift`: baseline source-schema capture on successful runs and the drift-diff semantics
  (added / removed / type-changed columns; no-baseline and no-drift both yield no report).

### Modified Capabilities

- `pipeline-analyze-api`: the analyze response gains an optional `sourceSchemaDrift` object (additive; existing
  consumers unaffected).

## Impact

- Backend: `PipelineRunService`, `PipelineService.analyze`, `PipelineRepository` (targeted read/write of the new
  column — the main `Pipeline` domain model and `*` projection stay untouched), new domain diff helper,
  `PipelineAnalyzeProtocol`.
- Schema: `schemas/pipeline-analyze-response.schema.json`; migration `V85__pipeline_last_source_schema.sql`.
- No frontend changes; no behavior change for existing analyze consumers (additive optional field; spray-json
  omits `None`).

## Non-goals

- Blocking a run on drift or raising an alert (fail-policy 419-C / Alerting epic).
- Frontend surfacing of drift (419-D or follow-up).
- Drift on the proposal-analyze path (`analyze-proposal` has no persisted pipeline, hence no baseline).
