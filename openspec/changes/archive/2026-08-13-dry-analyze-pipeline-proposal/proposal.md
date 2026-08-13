## Why

An agent authoring a `PipelineProposal` (HEL-379) has no way to see the projected output columns
before anything is created. `GET /api/pipelines/:id/analyze` only works for an already-created
pipeline. Without a dry analyze, the agent (and a human reviewer) can't verify the output schema
before the proposal is applied — exactly the gap the HEL-342 propose/apply model exists to close.

## What Changes

- Add `POST /api/pipelines/analyze-proposal`: takes a `PipelineProposal` body, resolves the source
  schema (existing `sourceId` under RLS, or an inline source's declared/inferred columns), folds the
  proposed `steps` through the existing `PipelineAnalyzeService` engine, and returns the projected
  per-step + final output schema plus any per-step validation errors. Writes nothing.
- Reuses `PipelineAnalyzeService` (the same pure schema-math engine `GET /:id/analyze` already uses)
  and `SqlConnector.checkQuery`/`inferSchema` and `RestApiConnector.inferSchema` (the same inline
  read-only-guard + inference calls `SourceService.inferSql`/`inferRest` already use) — no second,
  divergent analyze or inference implementation.
- Inline `static` sources are schema-derived directly from the proposal's declared `columns` (no
  inference call needed). Inline `csv` sources are **not** analyzable this way (no uploaded file
  exists yet for an unsaved proposal — `CsvSourceConfigPayload` carries only a `path`) and return a
  clear `400`, not a 500 or silent wrong answer.
- New `schemas/pipeline-analyze-proposal-response.schema.json` + backend protocol. Reuses
  `SchemaField` verbatim; the per-step shape matches the *actual* discriminated-union wire format
  (`type` discriminator + object `config` — what `analyzeStepResponseFormat` really emits today) rather
  than the existing `pipeline-analyze-response.schema.json`'s stale `$defs.AnalyzeStep`, which still
  declares a pre-CS2c-3a `op`/string-`config` shape never updated for the rework (design.md D6). No
  `id`/`outputDataTypeId` (nothing is persisted, so nothing has an id yet — same no-ids principle
  `PipelineProposal` itself follows).

## Capabilities

### New Capabilities

- `pipeline-proposal-analyze-api`: dry, non-persisting analyze over an unapplied `PipelineProposal`,
  reusing the existing analyze engine and inline-source inference/guard calls.

### Modified Capabilities

(none — additive only; existing `GET /api/pipelines/:id/analyze` and `PipelineProposal` unchanged)

## Impact

- New: `schemas/pipeline-analyze-proposal-response.schema.json`, a new protocol trait, a new
  `PipelineService.analyzeProposal` method, a new route in `PipelineRoutes.scala`, ScalaTest coverage.
- Touched: `PipelineRoutes.scala` (new route, ordered before the existing `PipelineIdSegment`
  branches so the literal `analyze-proposal` segment isn't swallowed as a bogus pipeline id).
- No migration, no existing wire shape changes.

## Non-goals

- Actually creating the source/pipeline/steps or running it (a separate atomic-apply ticket).
- MCP tool exposure (separate ticket, which will call this endpoint).
- Inline `csv` source analysis (no file exists yet for an unsaved proposal — returns 400).
