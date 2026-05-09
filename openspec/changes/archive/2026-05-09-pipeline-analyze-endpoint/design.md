## Context

`PipelineRoutes.scala` currently exposes `GET/POST /api/pipelines` and `GET/PATCH /api/pipelines/:id`.
`PipelineStepRoutes.scala` exposes `GET/POST /api/pipelines/:id/steps` and `PATCH/DELETE /api/pipeline-steps/:id`.
The `InProcessPipelineEngine` runs data through steps; it is not reusable for pure schema work.

The `DataType` entity stores a `fields: Vector[DataField]` (name, displayName, dataType string, nullable). When a
DataSource is created, a companion `DataType` is inserted with `sourceId` pointing to the DataSource — those fields
are the canonical source schema. The pipeline's `outputDataTypeId` points to a separate empty DataType (the
pipeline's output, starts empty and is updated after a run).

Source schema retrieval: `dataTypeRepo.findBySourceId(DataSourceId(pipeline.sourceDataSourceId))` returns the source
DataType. If no source DataType exists (edge case: DataSource created before this convention), fall back to an
empty schema.

## Goals / Non-Goals

**Goals:**
- Add `GET /api/pipelines/:id/analyze` returning pipeline summary + steps with per-step schemas
- Implement all 8 inference rules (pure schema math; no op engine required)
- Replace `runResult`-based field discovery in `SelectFieldsConfig` with analyze response
- Add JSON Schema + OpenAPI spec; pass `npm run check:schemas`

**Non-Goals:**
- Caching inference results
- Running actual data
- Modifying existing pipeline or step endpoints

## Decisions

**D1 — New `PipelineAnalyzeService` object in `domain/`**
Keeps inference logic out of the route handler. Pattern matches on `step.op`, parses `step.config` JSON, returns
`Vector[SchemaField]` per step. A `SchemaField` is a simple `(name: String, type: String)` — matches the wire
format exactly and avoids coupling to the heavier `InferredField` / `DataFieldType` hierarchy.
Alternative considered: inline in `PipelineRoutes`. Rejected — inference for 8 ops is too large for a route handler.

**D2 — New response case classes in `JsonProtocols`**
`SchemaFieldResponse(name: String, `type`: String)`, `AnalyzeStepResponse(id, position, op, config,
inputSchema, outputSchema, validationError)`, `PipelineAnalyzeResponse(id, name, sourceDataSourceName,
outputDataTypeName, outputDataTypeId, sourceSchema, steps)`. Follow existing naming convention.

**D3 — Source schema from DataType.fields, not raw DataSource config**
`dataTypeRepo.findBySourceId(DataSourceId(sourceDataSourceId))` returns the already-inferred and user-confirmed
field list. This reuses the existing schema registry; no need to re-parse DataSource config or run SchemaInferenceEngine.

**D4 — Malformed config: validationError + identity fallback**
If `step.config` JSON parse fails or a required key is missing, attach `validationError: Some(msg)` to that step's
response and treat it as identity (outputSchema = inputSchema). Downstream steps continue with the pre-error schema.
This matches the ticket requirement and avoids a 500 for one bad step.

**D5 — Inference for all 8 ops now**
The ticket provides complete config shapes for all 8 ops. Select inference is trivially implemented. Filter/limit/sort
are identity — zero risk. Rename/cast/compute config shapes are specified. Aggregate is the most complex but the
algorithm is clearly specified. Implementing now means HEL-188–194 do not need to touch this file.

**D6 — Frontend: `useAnalyzePipeline` hook + `analyzePipeline` thunk**
Follows the existing `usePipelineSteps` pattern. The `SelectFieldsConfig` component receives `columns` from
the analyze response step's `inputSchema` field names. The "run first" prompt is removed.

## Risks / Trade-offs

- [Risk] Source DataType may not exist if DataSource was created before the sourceId convention → Mitigation: empty
  schema fallback; `sourceSchema: []` is valid and the UI shows an empty checklist (better than a 500).
- [Risk] Aggregate config shape may differ when HEL-192 lands its engine → Mitigation: each op ticket owns its
  engine; if the config shape changes, it updates `PipelineAnalyzeService` at the same time.

## Planner Notes

- Inference for all 8 ops is self-approved (no new dependencies, no architectural change, no breaking API change).
- The `SelectFieldsConfig` "run first" prompt removal is self-approved per ticket AC.
- `sourceSchema` type string values (`"string"`, `"integer"`, `"float"`, `"boolean"`, `"timestamp"`) match the
  existing `DataFieldType.asString` output — no new type vocabulary.
