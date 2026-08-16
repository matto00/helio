# Design — Pipeline schema-drift detection (HEL-462)

## Context

Analyze-time `sourceSchema` is derived in `PipelineService.analyze` from the source DataType's declared fields:
`dataTypeRepo.findBySourceId(pipeline.sourceDataSourceId, user.id).headOption.fields` mapped to
`SchemaField(name, dataType)` (`backend/src/main/scala/com/helio/services/PipelineService.scala:200`). The run
path (`PipelineRunService.runPipeline` → `onRunSuccess`) currently persists only `updateLastRun` metadata.
There is no stored baseline schema.

## Decisions

### D1 — Baseline uses the same derivation as analyze (declared DataType fields), not row inference

On successful run, persist the schema produced by the *same* derivation `analyze` uses (source DataType declared
fields → `[{name, type}]`). Rejected alternative: inferring from the actually-loaded source rows via
`SchemaInferenceEngine.inferSchemaFromRows` — its `DataFieldType` representation and row-sampling semantics differ
from the DataType's declared `dataType` strings, so every analyze-time comparison would report spurious
`typeChangedColumns` (methodology drift, not source drift). Comparing like-with-like makes "no drift" the
guaranteed steady-state for an unchanged source. Extract the one-line derivation into a small shared helper so
analyze and run-success provably use identical logic (a private method on each service duplicating the map is
what causes silent divergence later).

### D2 — Storage: JSONB array of `{name, type}`; column stays out of the domain model

Migration `V85__pipeline_last_source_schema.sql` (verify V85 still free on origin/main at delivery; renumber if a
parallel branch claimed it): `ALTER TABLE pipelines ADD COLUMN last_source_schema JSONB;` with a header comment
per the `V53__panel_column_widths.sql` precedent. In `PipelineRepository`, do NOT add the column to
`PipelinesTable.*` / `PipelineRow` / the `Pipeline` domain model. Instead add two targeted-projection methods,
mirroring `updateLastRun`'s existing pattern (`PipelineRepository.scala:276`):

- `updateLastSourceSchema(pipelineId, schemaJson: String, user)` — targeted `.map(...).update(...)`.
- `findLastSourceSchema(pipelineId, user): Future[Option[String]]` — targeted select of the raw JSON string.

The Slick column is declared locally in those queries as `column[Option[String]]("last_source_schema")` (via a
table-local `def` on `PipelinesTable`, not in `*`). This keeps every existing read path, wire shape, and the
22-arity projection untouched — backward-compatible by construction.

### D3 — Pure diff helper in `com.helio.domain`

New object `PipelineSchemaDrift` (next to `PipelineAnalyzeService`, which owns `SchemaField`):

```scala
final case class TypeChangedColumn(name: String, previousType: String, currentType: String)
final case class SchemaDrift(addedColumns: Vector[SchemaField], removedColumns: Vector[SchemaField],
                             typeChangedColumns: Vector[TypeChangedColumn])
def diff(baseline: Option[Vector[SchemaField]], current: Vector[SchemaField]): Option[SchemaDrift]
```

Semantics: `baseline == None` → `None` (first run / no baseline). Identical schemas (order-insensitive by
`name`; duplicate names compared positionally-last, matching JSONB round-trip order) → `None`. Otherwise
`Some(drift)` where added = names only in current, removed = names only in baseline, typeChanged = shared names
whose `type` strings differ (exact string compare — types come from the same enumeration on both sides per D1).

### D4 — Persist hook in `onRunSuccess`, best-effort

In `runPipeline`'s success path, resolve the current source schema (D1 helper; requires `dataTypeRepo`, already
constructor-injected where needed — pass it into `PipelineRunService` if not present) and persist via
`updateLastSourceSchema` alongside the existing `updateLastRun(…, "succeeded", …)` in `onRunSuccess`
(`PipelineRunService.scala:533`). Wrap in `.recoverWith` returning success — baseline persistence must never
fail or block a run (same best-effort convention as `persistAssertions`). Dry runs (`onDryRunSuccess`) do NOT
persist a baseline — a dry run is not "a successful run" in the ticket's sense and would silently move the
baseline under a user experimenting in the editor.

### D5 — Drift computed in `PipelineService.analyze` only

`analyze` fetches the baseline via `findLastSourceSchema`, parses it to `Vector[SchemaField]` (tolerant parse:
malformed/legacy JSON → treat as no baseline, log at warn), computes `PipelineSchemaDrift.diff(baseline,
sourceSchema)`, and sets `sourceSchemaDrift: Option[SourceSchemaDriftResponse]` on `PipelineAnalyzeResponse`
(`jsonFormat7` → `jsonFormat8`; spray-json omits `None`, so the field is absent exactly when there is no
baseline or no drift). `analyzeProposal` is untouched (no persisted pipeline → no baseline by definition).

### D6 — Wire/schema shape

```json
"sourceSchemaDrift": {
  "type": "object",
  "required": ["addedColumns", "removedColumns", "typeChangedColumns"],
  "addedColumns": [{"name","type"}], "removedColumns": [{"name","type"}],
  "typeChangedColumns": [{"name","previousType","currentType"}]
}
```

Optional property on `pipeline-analyze-response.schema.json` — NOT added to `required`. `addedColumns`/
`removedColumns` reuse the schema's existing `SchemaField` `$def`.

## Planner Notes (self-approved)

- Baseline derivation choice (D1) and dry-run exclusion (D4) are judgment calls consistent with the ticket's
  intent; neither adds dependencies nor changes existing behavior.
- Run-path schema resolution uses the pipeline owner's context consistent with how `onRunSuccess` already
  performs owner-scoped writes (`user` param) — no new RLS surface.
- Tests: ScalaTest on `PipelineSchemaDrift.diff` covering AC (a)/(b)/(c) + no-drift; schema-validation coverage
  via the repo's existing JSON-schema test harness for the analyze response.
