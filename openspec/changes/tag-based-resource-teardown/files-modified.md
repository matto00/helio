# Files modified — HEL-366 tag-based-resource-teardown

## Sections 1-3 (backend data model, create/read paths, bulk-teardown endpoint — prior executor)

- `backend/src/main/resources/db/migration/V73__add_resource_tag.sql` — nullable `tag` column +
  partial index on `data_sources`/`pipelines`/`data_types`.
- `backend/src/main/scala/com/helio/domain/DataSource.scala` — `tag: Option[String]` on the
  `DataSource` sealed trait + all 7 concrete subtypes.
- `backend/src/main/scala/com/helio/domain/model.scala` — `tag` on `DataType`/`Pipeline` domain
  case classes.
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` — `tag` row mapper
  + `findAll(..., tag)` filter.
- `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala` — `tag` row mapper,
  `findAll(..., tag)` filter, `existsBoundToAnyOwnedPanelAction` extraction (tasks.md 3.1).
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala` — `tag` row mapper,
  `listSummaries(..., tag)` filter, `create(...)` propagates `tag` to both the pipeline row and its
  freshly-inserted output DataType.
- `backend/src/main/scala/com/helio/api/protocols/{DataSourceProtocol,DataTypeProtocol,PipelineProtocol}.scala`
  — `tag` on create-request and response wire types.
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — `validateTag` (200-char curated
  400).
- `backend/src/main/scala/com/helio/api/routes/{DataSourceRoutes,DataTypeRoutes,PipelineRoutes}.scala`
  — `?tag=` query param on the three list endpoints; `tag` threaded through create dispatch.
- `backend/src/main/scala/com/helio/services/{DataSourceService,DataTypeService,PipelineService}.scala`
  — `tag` threaded through create paths incl. companion-DataType propagation (7 sites).
- `backend/src/main/scala/com/helio/infrastructure/WorkspaceTeardownRepository.scala` — the
  teardown plan+delete DBIO composition (dependent-cascade guards, source-link guard, panel-bound
  guard, delete order).
- `backend/src/main/scala/com/helio/services/WorkspaceTeardownService.scala` — request
  normalization, response mapping, post-commit best-effort file cleanup.
- `backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala` — `POST /api/workspace/teardown`.
- `backend/src/main/scala/com/helio/api/protocols/WorkspaceProtocol.scala` — `TeardownRequest`/
  `TeardownConflictResponse`/`TeardownResponse` wire types.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala`, `backend/src/main/scala/com/helio/api/package.scala`
  — mix in `WorkspaceProtocol`; re-export its types.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`, `backend/src/main/scala/com/helio/app/Main.scala`
  — wire `WorkspaceRoutes` in via a nullable `dbContext` param.

## Section 4 — MCP surface (this cycle)

- `helio-mcp/src/types.ts` — `tag?: string | null` on `DataSourceResponse`/`DataTypeResponse`/
  `PipelineSummaryResponse`; new `TeardownConflictResponse`/`TeardownResponse` types.
- `helio-mcp/src/helioApi.ts` — `tag` param on `createDataSource`/`createCsvDataSource`/
  `createPipeline`/`createPipelineFromShape`; `tag` filter param on `listDataSources`/
  `listDataTypes`/`listPipelines`; new `teardownResources` method (`POST /api/workspace/teardown`).
- `helio-mcp/src/tools/write.ts` — `tag` on `create_data_source`/`create_csv_data_source`/
  `create_pipeline`/`create_pipeline_from_shape`; new `teardown_resources` tool (refuse-on-out-of-
  batch-dependent + dry-run-first guidance in its description).
- `helio-mcp/src/tools/read.ts` — `tag` filter param on `list_data_sources`/`list_data_types`/
  `list_pipelines`.
- `helio-mcp/src/context.ts` — `tag` on `WorkspaceContext`'s `dataSources`/`dataTypes`/`pipelines`
  entries.
- `helio-mcp/README.md` — `teardown_resources` row in the write-tools table.

## Section 5 — schema/OpenAPI docs (this cycle)

- `schemas/workspace-teardown-request.schema.json` (new) — `TeardownRequest` wire shape.
- `schemas/workspace-teardown-response.schema.json` (new) — `TeardownResponse` wire shape +
  embedded `TeardownConflict` `$def`.
- No new schemas for DataSource/Pipeline-summary/DataType core shapes — none exist in this repo
  today (see tasks.md 5.1's deviation note for the reasoning); the `?tag=` query-param addition is
  documented in the `resource-tagging` capability spec instead (query params aren't part of this
  repo's per-body-shape `schemas/` convention).

## Section 6 — ScalaTest coverage (this cycle)

- `backend/src/test/scala/com/helio/services/WorkspaceTeardownServiceSpec.scala` (new) — tasks.md
  6.3–6.9, 6.12: happy path, both dependent-cascade guard directions (untagged + differently-tagged
  dependent), DataType guards (panel-bound + source-link, including the 6.6a positive path),
  idempotency, dry-run, cross-owner isolation, and privileged-pool non-leak. Run under a real
  non-superuser `helio_app_test` RLS role (dual-pool harness mirroring `RlsOwnerTablesSpec`), not
  the simplified same-pool pattern most ACL specs in this repo use — required because
  `WorkspaceTeardownRepository`'s guard queries carry no explicit `owner_id` predicate and are
  RLS-scoped by design.
- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` (new) — tasks.md 6.1,
  6.2, 6.11: tag persistence through create → read (data source/pipeline/DataType companion
  propagation), `?tag=` list filtering (owner-scoped), and wire-format absent-vs-null/false parity
  for `tag`/`dryRun` (raw hand-written JSON, not the typed request case class, to genuinely exercise
  spray-json's field-absence handling).
- `backend/src/test/scala/com/helio/infrastructure/ResourceTagMigrationSpec.scala` (new) — tasks.md
  6.10: staged Flyway migration test (`.target("72")` then full `migrate()`, mirroring
  `TriggerSourceMigrationSpec`), pre-existing rows land with `tag = NULL`, the CHECK constraint is
  live, and read/update/delete continue to work through the repository layer.
- `backend/src/main/scala/com/helio/infrastructure/WorkspaceTeardownRepository.scala` — **bug fix**
  found while writing the 6.8 dry-run test: the `sourcesDeleted`/`pipelinesDeleted`/`typesDeleted`
  counts were gated on `committed` (unconditionally `false` for every dry run), so a dry run on a
  clean set reported all-zero counts instead of would-be counts, contradicting design.md Decision 4.
  Fixed by gating the three count fields on "clean" (`conflicts.isEmpty`) instead of `committed`.
