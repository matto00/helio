# Files modified — HEL-906 (cycle 5, implementing both evaluation-4.md coordinator rulings)

Cycles 1-4 sections below are unchanged. This section covers only cycle 5's diff.

## Ruling 1 (D3): real single Slick transaction

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — added `createAction` (DBIO variant of the pipeline-row insert) and `runTransactionally` (the single call site that opens the transaction spanning all 3 repositories).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — added `insertInternalAction` (DBIO variant of `insertInternal`, extracted for composition).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — added `insertInternalAction` (same extraction for Outputs).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `createTransactional`/`buildStepsAction`/`buildOutputsAction` rewritten to compose ONE `DBIO[PipelineSummary]` chain, run through exactly one `runTransactionally` call; `PipelineCreateValidationFailure` (new) carries a `ServiceError` out of the DBIO chain via `DBIO.failed`. Cycle 4's compensating-delete code deleted outright.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` — doc comment updated (real transaction, not compensating-delete); added a permanent raw-SQL `select count(*)` assertion to the "bad step type" rollback test as an extra check bypassing the repository layer.

## Ruling 2 (AC-3): boundary validation, schema enums, structural guard, dev-DB check

- `backend/src/main/scala/com/helio/domain/model/model.scala` — added `DataFieldType.CanonicalWireValues` (the one source of truth for the guard's error message, `validateAndCanonicalize`, and every schema enum) and `DataFieldType.validateAndCanonicalize` (canonicalize-then-validate, `Left` names every valid type).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `SchemaField`'s primary constructor now `require`s a canonical type (the structural guard); `canonicalizeLegacyType` delegates to the shared `DataFieldType.canonicalizeLegacy`; `inferAggregate` rewritten to explicitly validate `groupBy` entries' types (a specific `validationError` naming the bad field/value/valid-types, not the generic "aggregate config error" catch-all); `schemaFieldJsonFormat` hand-rolled to canonicalize on READ (tolerant of already-persisted legacy data) while writing canonically.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `createStatic` now validates every column's type up front, 400s naming every bad column + valid types, nothing persisted on failure; `applyStaticRefresh` (found live during this cycle's full-suite run, a 6th producer not named by the ruling) given the identical boundary-validation treatment.
- `backend/src/test/scala/com/helio/domain/engine/SchemaFieldStructuralGuardSpec.scala` (new) — proves the `require` guard is real: every canonical value accepted, `"number"`/`"banana"`/`""` all throw, message names every valid type.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — `baseSchema` fixture's pre-existing `"number"` (predating this ticket) fixed to `"float"`; 8 downstream assertions corrected; new `inferAggregate` `groupBy`-type-validation regression test.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala` — new `createStatic` boundary-validation 400 test; 2 new `applyStaticRefresh` tests (canonicalize-on-refresh, reject-with-400-on-refresh).
- `backend/src/test/scala/com/helio/domain/model/PipelineSchemaDriftSpec.scala`, `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala`, `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`, `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — pre-existing `"number"`/`"double"` fixtures (predating this ticket) fixed to canonical values; the guard aborted these suites on first load until fixed.
- `schemas/pipelines/pipeline-analyze-response.schema.json`, `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` — added the 7-value `DataFieldType` enum to the `$defs.SchemaField.type` property.
- `schemas/sources/static-column-payload.schema.json`, `schemas/sources/field-override-payload.schema.json` (new; `schemas/sources/` didn't exist before this cycle) — schemas for `StaticColumnPayload`/`FieldOverridePayload`, both with the enum.

## `position` classification (cycle 5)

No reader or writer of `position` was added or touched this cycle.

## Not implemented / explicitly deferred this cycle

- Boundary validation (explicit 400) was NOT extended to `SchemaInferenceFacade.toSchemaFields`'s override branch or `DataSourceService.createCsv`'s separate duplicate of the same override pattern — both are canonicalize-only (cycle 4) plus now protected by the structural guard's fail-loud backstop (a genuinely invalid override 500s rather than silently persisting), but do not yet return a clean, actionable 400. The ruling named exactly two boundary sites; extending further is mechanical but touches more call sites, left for a follow-up.
- The 12 already-persisted bad `data_sources.inferred_schema` rows in the shared dev DB were found and documented (execution-progress.md) but NOT fixed — this is a data migration, not a code change, and is recommended as a spinoff ticket (this executor's tool access in this cycle does not include Linear ticket creation).
- Task 3.2 (`parentStepId` on the EXISTING per-step route), CR6 (`PublicDashboardRoutes` rewire + `outputDataTypeId` drop), and the rest of CR8 remain untouched, per the standing coordinator instruction that these are carried obligations, not droppable.

---

# Files modified — HEL-906 (cycle 4, addressing evaluation-3.md)

Cycles 1-3 sections below are unchanged. This section covers only cycle 4's diff.

## Cycle 4 changes

- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — fixed the dry-run `assertionStatus` bug: `runs.find(_.status != "dry_run")` replaces `.headOption`; retracted the false "dry run persists no row" premise comment with the verified-correct fact. Added `validateOutputFieldMapping`-equivalent reuse (via the new `outputs[]` build path — see `PipelineService.scala`).
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — added `seedDryRunWithAssertions` fixture helper and the dry-run regression test.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineCapabilitiesRoutesSpec.scala` — added the RLS-vacuity doc note.
- `backend/src/main/scala/com/helio/domain/model/model.scala` — added `DataFieldType.canonicalizeLegacy` (promoted from `PipelineAnalyzeService`-local `canonicalizeLegacyType`, now the single shared definition every canonicalization call site uses).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `canonicalizeLegacyType` now delegates to `DataFieldType.canonicalizeLegacy`; `inferAggregate`'s `groupBy` field type now canonicalized (was a live bug, found by the construction-site sweep).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — inline static-source dry-analyze path (`c.type`) now canonicalized (live bug fix); extended `create` with the single-call transactional shape (`buildStepsAndOutputs`, `validateOutputFieldMapping`); added `outputRepo: OutputRepository = null` nullable-optional constructor param.
- `backend/src/main/scala/com/helio/services/sources/SchemaInferenceFacade.scala` — override branch now canonicalized (live bug fix, found by the sweep, not evaluator-named).
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `createCsv`'s separate override-branch duplicate now canonicalized (live bug fix, found by the sweep, not evaluator-named).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — threads `outputRepoOpt.orNull` into `pipelineService`'s construction.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — added `CreatePipelineTransactionalStepRequest`/`CreatePipelineTransactionalOutputRequest`; extended `CreatePipelineRequest` with `steps`/`outputs` (default-empty) via a **hand-rolled JSON reader** (not `jsonFormat5` — spray-json's macro doesn't apply Scala defaults for missing non-`Option` fields; caught by 3 existing tests failing on the first attempt, fixed before proceeding).
- `schemas/pipelines/create-pipeline-request.schema.json`, `create-pipeline-transactional-step-request.schema.json`, `create-pipeline-transactional-output-request.schema.json` (new) — task 1.2's `create-pipeline-request` half.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` (new) — 5 tests: full success (trunk + tail via `parentStepId` + 2 Outputs), rollback on bad step type, rollback on bad Output fieldMapping, rejection of an unresolvable `parentStepId` reference, pre-existing simple-create shape unaffected.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — added the `groupBy` canonicalization regression test.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — added the inline static dry-analyze canonicalization regression test.
- `backend/src/test/scala/com/helio/services/sources/SchemaInferenceFacadeSpec.scala` — added the override canonicalization regression test.
- `backend/src/test/scala/com/helio/services/sources/DataSourceServiceSpec.scala` — added the `createStatic` override canonicalization regression test.

## `position` classification (cycle 4)

No reader or writer of `outputs.position`/`pipeline_steps.position` was added this cycle.
`PipelineStepRepository.insertInternal` (called by the new transactional-create path) is a
PRE-EXISTING method, unmodified — its own sibling-scoped `position` append behavior is
untouched.

## Not implemented this cycle (see execution-progress.md's coordinator-ruling-acknowledgment section)

Task 3.2 (`parentStepId` on the EXISTING per-step route, splice removed-placement-count);
CR6 (`PublicDashboardRoutes` rewire, `outputDataTypeId` drop); the rest of CR8; a literal
single-Slick-transaction implementation of CR4 (compensating-delete substitutes, documented);
the inline-source variant of the single-call create endpoint.

---

# Files modified — HEL-906 (cycle 3, addressing evaluation-2.md CR items 1-3)

Cycle 1 and cycle 2 sections below are unchanged. This section covers only
cycle 3's diff.

## Cycle 3 changes

- `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala` — `inferTypeOf` fixed to emit canonical `"float"` instead of `"number"` for `NumLit`/`BinOp`/`length()` (the primary path `PipelineAnalyzeService.inferCompute` calls — the evaluator's cycle-3 finding).
- `backend/src/test/scala/com/helio/domain/engine/ExpressionEvaluatorSpec.scala` — 4 assertions pinned to the old `"number"` corrected to `"float"`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — added `canonicalizeLegacyType` (number/double→float, long→integer, date→timestamp) and applied it to `inferCompute`'s legacy-fallback path AND `inferCast`'s `casts` map (both found by the repo-wide re-sweep to have the same non-canonical-passthrough bug the named producers had).
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — 4 assertions corrected to canonical values; 2 new tests (`cast` double/long/date canonicalization, `compute` fallback-path `"double"` canonicalization).
- `backend/src/main/scala/com/helio/app/DemoData.scala` — seed data's `"amount"` field fixed from `"number"` to `"float"` (trivial, not a producer in the AC-3 sense).
- `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` — no change this cycle (function already existed from cycle 2); wired in below.
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — added `validateFieldMapping` (reads `config.fieldMapping`, validates against the Output's kind's slots) and calls it from `create` (before the pipeline ACL check) and `update` (against the MERGED config, before the write). Also added `assertionStatus` (AC 6, task 2.5): keyed by `NodeRef.stepId`, `None` → always `invalid = false`; scoped to the latest persisted (never-dry) run via the new `pipelineRunRepo` nullable-optional constructor param.
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` — added `GET /outputs/:id/assertion-status`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — threads `pipelineRunRepo` into `outputServiceOpt`'s construction.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — `AssertionStatusResponse.dataTypeId` renamed to `outputId` (dead scaffolding from HEL-576/P1.1 with no live producer — safe rename, no schema-drift break since both sides moved together).
- `schemas/outputs/output-assertion-status.schema.json` — matching `dataTypeId` → `outputId` rename + description update (route path, Output- not DataType-scoped).
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — added `PipelineRunRepository`/`PipelineStepRepository` fixtures; 4 new HEL-892 tests (create 400/201, update 400 + config-never-written verification) and 5 new `assertion-status` tests (raw-source no-op, passing run, failing run, cross-step isolation, ACL triad).

## `position` classification (cycle 3)

No reader or writer of `position` was added or touched this cycle.

## Not implemented this cycle (per evaluation-2.md's own explicit instruction not to attempt beyond item 3 unless budget remained after items 1-3)

Single-call transactional `POST /api/pipelines` + `parentStepId` (CR4);
`PublicDashboardRoutes` rewire + `outputDataTypeId` drop (CR6); the rest
of CR8 (rows, preview, validate-expression, shapes-expand envelope,
`inferredSchema`, decision-15 layout, lean pagination, `config.format`,
remaining schemas).

---

# Files modified — HEL-906 (cycle 2, addressing evaluation-1.md CR1-CR3/CR7/CR9/CR10)

Cycle 1 (below, unchanged from that report) implemented Output CRUD. Cycle 2
addresses evaluation-1.md's FAIL: per-node schema projection, capabilities-at-
node, the absorbed-bug regression tests, the two cheap route tests, the sweep,
and the two flagged comment/consistency issues. See `execution-progress.md`
for what's still deferred (CR4-CR6, most of CR8).

## Cycle 2 changes

- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — added `NodeStepInput` + `analyzeNodes` (per-node/trunk+tail schema projection walking `parentStepId`, task 3.3). **Fixed three real non-canonical field-type emissions found by the task 3.5 grep sweep**: `aggResultType`'s `sum`/`avg` branch and `inferWindow`'s `running_sum` branch both emitted `"number"` (not a `DataFieldType` wire value) — now `"float"`; `inferDateBucket` emitted `"date"` — now `"timestamp"`.
- `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — added 3 `analyzeNodes` tests (tail-differs-from-trunk, tail-input-is-parent-output, empty-list); updated the 4 existing assertions pinned to the old wrong `"number"`/`"date"` values to the corrected canonical ones (never left red or silently deleted).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/NodeCapabilitiesProtocol.scala` (new) — `NodeCapabilitiesResponse`, reusing `PanelCapabilityColumnResponse`/`PanelCapabilityResponse` verbatim.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `NodeCapabilitiesProtocol`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — added `capabilitiesAtNode` (task 3.4): sharing-aware pipeline read, builds the node projection via `analyzeNodes`, evaluates `OutputBindingSpec.All` against it.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala` — added `GET /pipelines/:id/capabilities?stepId=`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineCapabilitiesRoutesSpec.scala` (new) — source-level and tail-step capabilities, unknown-stepId 404, owner/editor-grantee/unrelated-caller ACL (200/200/404), the HEL-895/638 sum-aggregate-binds repro, the HEL-644 select-retention repro.
- `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` — added `validateFieldMapping` (HEL-892 slot-name validation, domain logic only — not yet wired to a live route, see deferrals below).
- `backend/src/test/scala/com/helio/domain/panels/OutputBindingSpecSpec.scala` (new) — unit coverage for `validateFieldMapping`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — fixed the evaluator's non-blocking suggestion: `updateOwned`'s empty-body (no-op) branch now checks ownership explicitly (`findByOwned`, private) instead of falling back to the sharing-aware `findById`, so an empty-body `PATCH` from a non-owner grantee 404s instead of 200ing.
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — added the empty-body-PATCH-from-grantee 404 regression test (proves the fix above), and a new `GET /outputs/:id/panels` test block (owner/grantee/other + empty-placements case) — cycle 1's tasks.md claim that this route was "tested" was incorrect (evaluation-1.md finding #2); now genuinely covered.
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` — corrected the stale "mounted twice" scaladoc (it's mounted once via `concat`).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — removed the dead duplicate placeholder comment above `outputRepoOpt` (the real `outputServiceOpt` construction, and its own comment, are 40+ lines below).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added the AC-5 route test (task 4.1/4.2): `/api/types/*` and `/api/metrics/*` 404, `/api/panels/bound` 405 (path resolves to `PanelIdSegment`'s bogus-id branch — no `POST` handler there, proving no such route exists just as conclusively as a 404), `/api/panels/:id/query` 404. No production code change was needed (confirmed already-absent by cycle 1's grep); this closes the "assertion still owed" gap evaluation-1.md flagged.

## `position` classification (cycle 2)

No reader or writer of `position` was added or touched this cycle either.

## Not implemented this cycle (see execution-progress.md) — CR4/CR5/CR6/most of CR8

Single-call transactional `POST /api/pipelines` + `parentStepId` on step
create/delete-splice-report (CR4); `GET /api/outputs/:id/assertion-status`
+ alert-rule `targetOutputId` create/read (CR5); `PublicDashboardRoutes`
rewire off `findLastRunAtByOutputDataTypeId` + dropping
`outputDataTypeId`/`outputDataTypeName` from `PipelineRepository`/
`PipelineService` (CR6); `GET /api/outputs/:id/rows`,
`POST /api/pipelines/:id/preview`,
`POST /api/pipelines/:id/validate-expression?stepId=`,
`pipeline-shapes/:id/expand` envelope + `parentStepId`,
`DataSource.inferredSchema`, decision-15 server-owned panel layout, lean
paginated `/api/outputs`+`/api/dashboards`, `config.format` (HEL-876), the
`output-capabilities-response`/`preview-outputs-response` schemas (CR8).
`OutputBindingSpec.validateFieldMapping` (HEL-892) is implemented and
unit-tested but not wired to any live HTTP route yet — no endpoint accepts
an Output `fieldMapping` payload this cycle, so there is no HTTP-level 400
regression test for it (only the domain-logic unit test).

---

# Cycle 1 (original, unchanged)

This cycle implemented Output CRUD (tasks 2.1-2.4 partial) only. See
`execution-progress.md` for what's deferred.

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — added `findById` (sharing-aware RLS select), `findConfigById`, `updateOwned` (owner-only RLS update, with a `rowsAffected == 0` → `None` guard so an RLS-blocked write reports 404 rather than a silent no-op success).
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` — added `findByOutputIdInternal`/`deleteByOutputIdInternal` (ACL-bypassing; caller must confirm Output ownership first) for the `DELETE /api/outputs/:id` cascade and `GET /api/outputs/:id/panels`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/OutputProtocol.scala` (new) — wire shapes: `OutputResponse`, `OutputsResponse`, `CreateOutputRequest`, `UpdateOutputRequest`, `DeleteOutputResponse`, `OutputPanelPlacementResponse`.
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — added `OutputIdSegment`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `OutputProtocol`.
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` (new) — business logic for list-by-pipeline, create, findById, update (HEL-877 one-level-deep partial merge for `legend`/`tooltip`/`seriesColors`/`axisLabels`), delete (cascades panel placements, owner-checked explicitly against `output.ownerId` before the two ACL-bypassing repo calls), listPanels.
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` (new) — `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`, `GET /api/outputs/:id/panels`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `outputServiceOpt`/`OutputRoutes` into the authenticated route tree (nullable-optional pattern, gated on `dbContext`).
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` (new) — HTTP-layer ACL coverage (real embedded-Postgres, non-superuser app-pool role so RLS actually evaluates): owner/editor-grantee/unrelated-caller for create/list/read/update/delete, HEL-877 partial-merge round-trip, cascade-delete placement report.
- `schemas/outputs/output.schema.json`, `create-output-request.schema.json`, `update-output-request.schema.json`, `output-schema-field.schema.json` (new) — task 1.1.

---

# Cycle 6 (evaluation-5.md CR1/CR2/CR3/CR6, this cycle)

- `backend/src/test/scala/com/helio/domain/engine/SchemaFieldRealDumpInvariantSpec.scala` (new) — the coordinator's required fixture-based invariant guard (CR1): loads the real `hel904-real-dump.sql` scrubbed dump into a fully-migrated Postgres, reads a representative real pipeline's persisted source schema + step rows, runs the actual `analyzeNodes` production path (trunk + every tail), asserts every field satisfies `DataFieldType.fromString`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — `schemaFieldJsonFormat.read`'s residual hole (CR1's callout): widened the fallback for a genuinely unrecognized persisted type from throwing (500) to `StringType` with a loud warning log, rather than leaving the crash path.
- `backend/src/test/scala/com/helio/domain/engine/SchemaFieldJsonFormatTolerantReadSpec.scala` (new) — regression coverage for the above (pass-through/canonicalize/fallback-to-string for garbage and empty type strings).
- `openspec/changes/output-routes-api-contracts/tasks.md` — named HEL-931 (typed-`DataFieldType`/`SchemaField` refactor deferral target) and HEL-932 (dev-DB data-fix ticket) per CR2; marked 4.3/4.4 done.
- `openspec/changes/output-routes-api-contracts/design.md` — D3 rewritten to describe the ratified option-(iii) design (real 3-repository `DBIO` composition, compensating-delete deleted outright) plus a new RLS-posture note (CR2/CR3).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — `runTransactionally`'s RLS-bypass justification comment added (CR3/CR-C, per `DbContext.withSystemContext`'s own scaladoc requirement); dropped the now-visibly-redundant inner `.transactionally` (minor #8).
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — CR6: rewired `dataAsOf` onto `panel → output → pipeline.lastRunAt` for `OutputPanel`-kind placements (the only panel kind with a direct output binding); degrades to `None` for every other kind or an unresolvable Output/pipeline. Takes new optional `outputRepoOpt`/`pipelineRepoOpt` constructor params.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `outputRepoOpt`/`pipelineRepo` into the `PublicDashboardRoutes` constructor call.
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala` (new) — HTTP-layer test (real embedded Postgres): an Output-backed placement returns `dataAsOf` = the bound pipeline's real persisted `lastRunAt`; a non-Output panel kind still returns `None`; an Output-backed placement on a never-run pipeline also returns `None`.

**Not reached this cycle** (see execution-progress.md for the full list): task 3.2 (`parentStepId` on the existing per-step route + DELETE splice report), and CR8's remaining route surface (`validate-expression`, `rows`, `preview`, `inferredSchema`/task 1.3, shapes-expand envelope, paginated lists, `config.format`, panel layout, remaining response schemas).

---

# Cycle 7 (evaluation-6.md, RLS experiment + P1.4-dependency route surface)

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala` — `runTransactionally` switched from `withSystemContext` to `withUserContext(userId)` after the empirical RLS experiment confirmed it works unmodified; bypass-justification comment removed (no bypass anymore); redundant `.transactionally` dropped.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `createTransactional` threads `user.id.value` into `runTransactionally`; added `validateExpression` + shared `projectedSchemaAtNode` helper (extracted from `capabilitiesAtNode`); `persistNewStep` honors an explicit `parentStepId` (precedence over `position`); `deleteStep` now returns `DeletePipelineStepResponse`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepositoryRunTransactionallyRlsSpec.scala` (new) — the RLS experiment's permanent regression evidence, against a real non-superuser RLS-enforced app pool.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` — added `listRowsPaged` (offset/limit + total count).
- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — added `listAll` (`GET /api/outputs`), `rows` (`GET /api/outputs/:id/rows`); `nodeSnapshotRepo` nullable-optional constructor param.
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` — added `GET /outputs` (list) and `GET /outputs/:id/rows` routes.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `nodeSnapshotRepoOpt` into `OutputService`'s constructor.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — extracted `previewStep`'s body into a shared `previewAtNode` helper (also handles the source-level, `targetStepId = None` case); added `previewOutput`.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala` — added `POST /pipelines/:id/preview?outputId=`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — `CreatePipelineStepRequest.parentStepId` (optional); new `DeletePipelineStepResponse`.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineStepRoutes.scala` — `DELETE /pipeline-steps/:id` returns `200 DeletePipelineStepResponse` instead of `204`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/NodeCapabilitiesProtocol.scala` — new `ValidateExpressionRequest`/`ExpressionValidationResponse`.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala` — added `POST /pipelines/:id/validate-expression?stepId=`.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineShapeProtocol.scala` — `ShapeStepExpansionResponse` gained `clientId`/`parentStepId`; new `ExpandPipelineShapeResponse{steps, outputs}` envelope (BREAKING).
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineShapeRoutes.scala` — `POST /pipeline-shapes/:id/expand` returns the new envelope.
- `backend/src/main/scala/com/helio/api/package.scala` — alias for `ExpandPipelineShapeResponse`.
- `backend/src/main/scala/com/helio/api/protocols/PaginationProtocol.scala` — `PagedResult[OutputResponse]` format for `GET /api/outputs`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — added `rows`/`preview`/`GET /outputs` (list) route wiring + tests (ACL triads, offset/limit, run-state-unchanged).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — added `previewOutput` tests including the run-state-unchanged proof.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — updated `DELETE` assertions to the new `200` envelope; added `parentStepId` splice/reject tests and the branch-point splice-count test.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala` — updated one `DELETE /pipeline-steps/:id` assertion to `200`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineCapabilitiesRoutesSpec.scala` — added `validate-expression` test block.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala` — updated the envelope-shape test; added a multi-step chaining test.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — updated the shapes-expand composed-route-tree test to the new envelope; corrected the stale "dataAsOf retired" test title/comment (assertion itself unchanged, still correct for a text panel).
- `schemas/pipelines/delete-pipeline-step-response.schema.json`, `schemas/pipelines/validate-expression-request.schema.json`, `schemas/pipelines/expression-validation-response.schema.json` (new); `schemas/pipelines/create-pipeline-step-request.schema.json` (added `parentStepId`).

**Not reached this cycle**: `DataSource.inferredSchema` on `DataSourceResponse` (task 3.10 + 1.3), decision-15 panel-layout defaults (task 2.7), `config.format`/HEL-876 (task 2.3b), `output-capabilities-response`/`preview-outputs-response` schemas (rest of task 1.1). See execution-progress.md for the full reasoning.

**Known, deliberately-unfixed consumer break (task 3.8's envelope change, contracts-only scope)**: `frontend/src/features/pipelines/{ui/shapes/ShapePickerModal.tsx, types/pipelineShape.ts, services/pipelineService.ts, ui/shapes/ShapeParamsFields.tsx, services/pipelineService.test.ts}`, `e2e/hel399-shape-instantiate.spec.ts`, `helio-mcp/src/{tools/write.ts, helioApi.ts, types.ts}` — see tasks.md 3.8's note.

---

# Cycle 9 (final-gate skeptic dimension-split: 2 real gaps + spec-vs-code drift)

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — `previewAtNode`'s scaladoc corrected to cite the REAL run-state-unchanged tests (was citing a nonexistent `PipelinePreviewRunStateUnchangedSpec`).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — `CreatePipelineTransactionalStepRequest`'s doc corrected from "compensating-delete rollback" (the opposite of what shipped) to describe the ratified single-transaction design.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `createTransactional`'s doc corrected from `DbContext.withSystemContext` (stale, pre-cycle-7) to `withUserContext`.
- `helio-mcp/src/helioApi.ts` — corrected the stale "every delete endpoint answers 204" comment block to disclose the `DELETE /api/pipeline-steps/:id` exception this ticket introduced.
- `openspec/changes/output-routes-api-contracts/specs/pipeline-steps-persistence/spec.md` (new) — MODIFIED delta disclosing the `DELETE /api/pipeline-steps/:id` 204→200 breaking change, with the consumer-impact analysis (zero, both real consumers discard the body/status).
- `openspec/changes/output-routes-api-contracts/specs/pipeline-shape-registry/spec.md` — rewritten to match the shipped request/response shapes (no request-side `parentStepId`; `{clientId, kind, config, parentStepId}` entries; deleted the two unimplementable OutputContract-outputs-block scenarios; added a multi-step-chaining scenario).
- `openspec/changes/output-routes-api-contracts/specs/pipeline-create-api/spec.md` — rewritten to match shipped field names (`sourceDataSourceId`, `clientId`/`parentStepId`/`nodeStepClientId`, bare `PipelineSummaryResponse`); flagged the unfiled inline-source-variant gap explicitly.
- `openspec/changes/output-routes-api-contracts/specs/output-routes-api/spec.md` — fixed `page/pageSize`→`offset/limit`, sharing-aware→owner-only for the lean list, "404 never 403"→the shipped 403/404 split, deleted the `config.format` requirement (moved to HEL-933's own future change).
- `openspec/changes/output-routes-api-contracts/specs/pipeline-preview-api/spec.md` — rewritten to match shipped behavior (outputId required, single-node `RunResultResponse`, not a per-Output envelope); the all-Outputs-variant question flagged explicitly as unresolved.
- `openspec/changes/output-routes-api-contracts/specs/dashboard-panel-layouts/spec.md`, `openspec/changes/output-routes-api-contracts/specs/data-source-persistence/spec.md` — DELETED (both describe wholly-unimplemented behavior deferred to HEL-933; archiving them here would record a contract the API doesn't honor).

**No functional code changes this cycle** — this was entirely documentation/spec/comment corrections plus one scaladoc citation fix, per the requesting agent's own framing of the cycle.

---

# Cycle 10 (coordinator ruling: implement absent-outputId preview arm)

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — `previewOutput` renamed/rewritten to `previewOutputs(pipelineId, outputId: Option[OutputId], user)`; absent-`outputId` arm fans out to every Output on the pipeline, computing each distinct node once; `previewAtNode`'s doc citation updated for the rename and to cover both arms' tests.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — new `OutputPreviewEntry`/`PipelinePreviewResponse` (the uniform envelope both preview arms return) + JSON formats.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala` — `outputId` query param changed from required to optional; class doc updated.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — `previewOutput` describe block renamed/rewritten to `previewOutputs`, updated for the envelope; 6 new all-Outputs-arm tests including its own dedicated run-state-unchanged test.
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — single-Output preview tests updated for the envelope; new all-Outputs-arm test block (ACL triad, empty-Outputs, run-state-unchanged).
- `openspec/changes/output-routes-api-contracts/specs/pipeline-preview-api/spec.md` — rewritten to describe the now-correct contract (outputId optional, uniform envelope, scenarios for both arms including per-arm run-state-unchanged).
- `openspec/changes/output-routes-api-contracts/design.md` — D13 corrected: `preview-outputs-response` removed from the P1.3b list (shipped this cycle as `pipeline-preview-response.schema.json`; only `output-capabilities-response` remains deferred).
- `openspec/changes/output-routes-api-contracts/tasks.md` — task 3.7 marked done (was never checked despite existing since cycle 7); task 1.1's stale note about the deferred preview schema corrected.
- `schemas/pipelines/pipeline-preview-response.schema.json` (new).

---

# Cycle 11 (round-2 final-gate skeptics: wire-vs-spec drift on expand's outputs key)

- `openspec/changes/output-routes-api-contracts/specs/pipeline-shape-registry/spec.md` — corrected `outputs: null` claim to describe the real shipped behavior (key OMITTED entirely, spray-json's default `OptionFormat` with no `NullOptions` mixed in).
- `openspec/changes/output-routes-api-contracts/specs/pipeline-create-api/spec.md` — corrected "unfiled" wording to reference HEL-933.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala` — added a raw-`JsObject` assertion (key genuinely absent, not just `resp.outputs shouldBe None`) to the existing expand-envelope test.

**No functional code changes this cycle** — docs + one test assertion, per the requesting agent's own framing.

---

# Cycle 12 (round-3 final-gate skeptics: same wire-shape imprecision class, nodeStepId)

- `openspec/changes/output-routes-api-contracts/specs/output-routes-api/spec.md` — corrected the root-bound-Output-creation requirement/scenario from "`nodeStepId` is null" to describe the real shipped behavior (key OMITTED entirely, same `NullOptions`-absent class as cycle 11's `expand`/`outputs` fix).
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — added a raw-`JsObject` assertion to the existing root-bound-Output-creation test (key genuinely absent, not just `resp.nodeStepId shouldBe None`).

**No functional code changes this cycle** — docs + one test assertion, same pattern as cycle 11.

---

# Cycle 13 (round-4 final-gate skeptics: third and final Option-field instance, parentStepId)

- `openspec/changes/output-routes-api-contracts/specs/pipeline-shape-registry/spec.md` — corrected `parentStepId: String | null` to `parentStepId?: String` in the requirement text and both scenarios describing the first expanded step.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineShapeRoutesSpec.scala` — added raw-`JsObject` assertions to BOTH expand tests (single-step: first entry omits `parentStepId`; multi-step: first entry omits it, second entry carries it as a real string), closing the case-class-level blind spot that let this pattern survive three review rounds.

**No functional code changes this cycle** — docs + test assertions, same pattern as cycles 11/12. Per the skeptic's exhaustive enumeration, this is the last instance of this finding class.
