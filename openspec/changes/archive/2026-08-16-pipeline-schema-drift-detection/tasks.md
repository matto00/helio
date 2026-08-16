# Tasks — Pipeline schema-drift detection (HEL-462)

## 1. Persistence

- [x] 1.1 Add `V85__pipeline_last_source_schema.sql`: `ALTER TABLE pipelines ADD COLUMN last_source_schema JSONB;`
      with a header comment per the `V53__panel_column_widths.sql` precedent. FIRST verify V85 is still the next
      available number on origin/main (`git fetch origin main` + list `db/migration/`); if a parallel branch
      claimed it, take the next free number and update design/tasks references.
- [x] 1.2 `PipelineRepository`: add table-local `lastSourceSchema` column def (NOT in `*`), plus targeted
      `updateLastSourceSchema(pipelineId, schemaJson, user)` and `findLastSourceSchema(pipelineId, user)`
      following `updateLastRun`'s projection pattern (design D2).

## 2. Domain diff helper

- [x] 2.1 New `backend/src/main/scala/com/helio/domain/PipelineSchemaDrift.scala`: `SchemaDrift`,
      `TypeChangedColumn`, and `diff(baseline: Option[Vector[SchemaField]], current): Option[SchemaDrift]`
      per design D3 (no baseline → None; order-insensitive equality → None).
- [x] 2.2 Shared source-schema derivation helper (DataType declared fields → `Vector[SchemaField]`) used by both
      the analyze path and the run-success path (design D1).

## 3. Run-success baseline capture

- [x] 3.1 `PipelineRunService`: on non-dry success, resolve current source schema via the shared helper and
      persist through `updateLastSourceSchema` alongside `updateLastRun(…, "succeeded", …)`; best-effort
      (`recoverWith` → success), never failing the run (design D4). Inject `dataTypeRepo` if not already
      available. Dry runs and failed runs do not touch the baseline.

## 4. Analyze surfacing

- [x] 4.1 `PipelineService.analyze`: fetch baseline via `findLastSourceSchema`, tolerant-parse JSON →
      `Vector[SchemaField]` (malformed → no baseline, warn log), compute `PipelineSchemaDrift.diff`, populate
      new `sourceSchemaDrift` field (design D5). `analyzeProposal` untouched.
- [x] 4.2 `PipelineAnalyzeProtocol`: `SourceSchemaDriftResponse` + `TypeChangedColumnResponse` case classes and
      formats; `PipelineAnalyzeResponse` gains `sourceSchemaDrift: Option[SourceSchemaDriftResponse]`
      (`jsonFormat7` → `jsonFormat8`). No FQNs.
- [x] 4.3 `schemas/pipeline-analyze-response.schema.json`: optional `sourceSchemaDrift` property per design D6,
      reusing the `SchemaField` `$def`; NOT added to `required`.

## 5. Tests & gates

- [x] 5.1 ScalaTest for `PipelineSchemaDrift.diff`: (a) no baseline → no drift; (b) removed column in
      `removedColumns`; (c) type change in `typeChangedColumns`; plus identical-schemas (reordered) → no drift
      and added-column case.
- [x] 5.2 Schema/protocol coverage: analyze response with and without `sourceSchemaDrift` validates against the
      updated JSON schema via the repo's existing schema-validation test harness; absent-when-None serialization
      asserted.
- [x] 5.3 Run-success persistence coverage: unit-level test that the success path invokes baseline persistence
      and the dry-run path does not (mock/stub repo level, matching existing `PipelineRunService` test style).
- [x] 5.4 `sbt test` green; frontend untouched (no lint surface expected); `openspec validate` clean.

## 6. Fold-in: malformed-baseline tolerant-parse test (approved post-review 2026-08-16)

- [x] 6.1 Direct test for design D5's malformed-baseline branch: extend `PipelineAnalyzeRoutesSpec` with a new
      case alongside the existing baseline-seeding tests (lines ~241-268), seeding the baseline via
      `pipelineRepo.updateLastSourceSchema(pid, "\"not-json\"", user)` — syntactically valid JSON (a bare JSON
      string; the JSONB column rejects literally-invalid JSON at write time) but not schema-array-shaped, so it
      exercises `parseBaselineSchema`'s tolerant-parse failure branch via a real DB round-trip. Real
      `EmbeddedPostgres` seeding, NO mocking (matches the file's mock-free convention). Assert analyze yields
      200 with no `sourceSchemaDrift` member and no error. Test-only; no production-code change expected.
- [x] 6.2 Re-run gates: full `sbt test` green, `npm run check:schemas` clean; commit.
