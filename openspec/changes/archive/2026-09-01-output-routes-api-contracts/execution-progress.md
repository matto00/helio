# Execution progress — HEL-906 (cycle 1)

## Scope delivered this cycle

Given the size of the full ticket (tasks.md sections 1-5 span the entire
Output CRUD surface, the single-call `create_pipeline` transaction, per-node
schema projection + capabilities + preview + validate-expression, and a
cleanup sweep), this cycle implemented and fully verified **Output CRUD**
(the routes the ticket title leads with) end to end:

- `schemas/outputs/{output,create-output-request,update-output-request}.schema.json` + a schema-field helper (task 1.1, partial — see below)
- `OutputRepository` additions: sharing-aware `findById` (RLS `outputs_select`), `findConfigById`, owner-only `updateOwned` (RLS `outputs_update`, with an explicit `rowsAffected == 0 → None` guard so an RLS-blocked write reports 404 rather than silently no-oping)
- `PanelRepository` additions: `findByOutputIdInternal`, `deleteByOutputIdInternal` (cascade)
- `OutputService` (2.1), `OutputRoutes` (2.2), wired into `ApiRoutes.scala`
- `DELETE /api/outputs/:id` cascade + removed-placement report (2.3)
- `PATCH /api/outputs/:id` partial-merge config for `legend`/`tooltip`/`seriesColors`/`axisLabels` (2.3a, HEL-877)
- `GET /api/outputs/:id/panels` (part of 2.4)
- `OutputRoutesSpec`: 9 HTTP-layer tests against a real embedded-Postgres instance with a genuine non-superuser app-pool role (not the ambient superuser — RLS is otherwise vacuous, see `project_rls_testing_parity_gap.md`), covering owner/editor-grantee/unrelated-caller for every route above, the HEL-877 partial-merge round-trip, and the cascade-delete report.

Two real ACL bugs were caught and fixed by this test suite (not merely
demonstrated — the tests were red first):

1. `OutputRepository.updateOwned` originally re-read the row via a
   sharing-aware `findById` unconditionally after the UPDATE, so an
   RLS-blocked write (non-owner grantee) looked like a successful no-op
   (200 with the unchanged row) instead of a 404. Fixed by tracking
   `rowsAffected` and returning `None` when the RLS policy silently
   dropped the write.
2. `OutputService.delete` checked only sharing-aware access (any grantee)
   before calling the two ACL-bypassing privileged repo methods
   (`panelRepo.deleteByOutputIdInternal` / `outputRepo.deleteInternal`),
   so an editor grantee (not the owner) could delete another user's
   Output and its panels. Fixed by checking `output.ownerId == user.id`
   explicitly in the service before those privileged calls.

## NOT implemented this cycle (deferred to a follow-up execution cycle)

This is the majority of the ticket's tasks.md by task count. Listed
explicitly per "do not silently narrow scope":

- **1.2/1.3**: `create-pipeline-request`/`create-pipeline-step-request.parentStepId` schemas, `schemas/sources/data-source.schema.json`
- **2.3b**: `config.format` (HEL-876)
- **2.4 (rows)**: `GET /api/outputs/:id/rows`
- **2.5**: `GET /api/outputs/:id/assertion-status`
- **2.6**: lean paginated `/api/outputs`, `/api/dashboards` list
- **2.7**: `PanelService.create` decision-15 default layout
- **Section 3 (all)**: single-call `create_pipeline`, `parentStepId` on step create/delete, `PipelineAnalyzeService` per-node projection, `GET /api/pipelines/:id/capabilities?stepId=`, the HEL-895/638/644/892 field-type/slot regression tests, `POST /api/pipelines/:id/preview`, `pipeline-shapes/:id/expand` envelope change, `POST /api/pipelines/:id/validate-expression`, `DataSource.inferredSchema` exposure
- **Section 4 (4.3/4.4)**: `PublicDashboardRoutes` rewire off `findLastRunAtByOutputDataTypeId`, dropping `outputDataTypeId`/`outputDataTypeName` from `PipelineRepository`/`PipelineService`. Tasks 4.1/4.2 were already satisfied by prior HEL-904 work (verified by grep, no code change needed here).
- **5.2/5.3**: single-call transaction rollback test, HEL-895/638 metric-Output-over-aggregate repro test

## HEL-910 sweep (task 4.5, scoped to files touched this cycle)

Grepped every file this cycle modified/added for
`com\.helio\..*DataType|DataTypeId|MetricDefinition|MetricId|type_id|dataTypeId|metricId|/registry|/metrics|computed_fields|@deprecated`.
Only comment-context hits, all pre-existing and out of this cycle's scope
(not introduced by this change):

- `PanelRepository.scala:239,273,319` — pre-existing comments describing the
  post-HEL-904 `type`/`type_id` discriminator history; no live code path.
- `ApiRoutes.scala:248` — pre-existing comment about `metricId` on proposal
  panels (unrelated proposal-panel-support code, not touched by this diff).

No `@deprecated`, alias, or shim was added in this diff.

## Why this cycle stopped here

Sections 3 and the remaining parts of section 2 require substantial new
engine/service work (`PipelineAnalyzeService` per-node projection is a
prerequisite for capabilities/validate-expression/several regression tests;
the single-call `create_pipeline` transaction is its own multi-branch
rollback-tested feature) that was not reachable with the same
verification rigor (real embedded-Postgres tests, root-caused fixes,
fresh-evidence gate runs) in this cycle. Continuing in a follow-up cycle
rather than rushing an unverified implementation of the remaining surface.

---

# Cycle 2 (addressing evaluation-1.md, FAIL)

evaluation-1.md scored cycle 1 at 3/9 AC met (Output CRUD was clean but the
ticket's largest deliverables — per-node projection, capabilities, the
absorbed-bug regressions, single-call pipeline creation — were entirely
absent). This cycle worked the critical path in the order the report gave:

## Delivered

- **CR1 (highest leverage)**: `PipelineAnalyzeService.analyzeNodes` — real
  per-node (trunk + every tail) schema projection over the `parentStepId`
  tree. Verified with a test that a tail's projection genuinely DIFFERS
  from the trunk's (drops a column via `select`), not a same-shape
  same-value assertion.
- **CR2**: `GET /api/pipelines/:id/capabilities?stepId=`, consuming CR1's
  projection through `OutputBindingSpec`. 4 route tests: source-level
  metric/chart bindability, tail-specific unbindability, unknown-stepId
  404, and the owner/editor-grantee/unrelated-caller ACL triad.
- **CR3**: the four absorbed-bug regressions, ALL of which found real bugs
  (not clean passes on the first attempt):
  - HEL-895/638 (sum/avg): `aggResultType` emitted `"number"`, a
    non-canonical value `DataFieldType.fromString` silently drops — a
    sum-aggregate output column would vanish from `columns` and never be
    reported as `metric`-eligible. Fixed to `"float"`.
  - The task 3.5 grep sweep, done properly (every hardcoded type-string
    literal in the file, not just the two the ticket named), also caught
    `inferWindow`'s `running_sum` branch (same `"number"` bug) AND
    `inferDateBucket` emitting `"date"` — not a canonical `DataFieldType`
    value at all. Both fixed (`"float"`, `"timestamp"`).
  - HEL-644 (select retention): route-level test confirms a
    `select`-produced column survives projection and stays bindable.
  - HEL-892 (bad slot name): added `OutputBindingSpec.validateFieldMapping`
    (new domain function, unit-tested) — but **not wired to any live HTTP
    route**, since no endpoint accepts a `fieldMapping` payload yet (that's
    output-binding CRUD, CR8/a later cycle's job). Flagging this rather
    than fabricating a route just to exercise it.
- **CR7**: `ApiRoutesSpec` now has the AC-5 route test (`/api/types/*`,
  `/api/metrics/*` 404; `/api/panels/bound` 405 — see the test's comment
  for why 405 is the correct status there, not a defect; `/api/panels/:id
  /query` 404). No production change needed, as cycle 1's grep already
  established.
- **CR9**: `GET /api/outputs/:id/panels` now has a real HTTP test (owner/
  grantee/other + empty-placements) — cycle 1's tasks.md claim that this
  was "tested" was wrong (evaluation-1.md finding #2); corrected.
- **CR10**: re-ran the HEL-910 sweep across the full cycle-1+cycle-2 diff;
  every hit is a pre-existing/expected comment or a test's own literal
  route-path string, no live dead reference.
- **The two flagged comment issues**: `OutputRoutes.scala`'s stale
  "mounted twice" scaladoc corrected; `ApiRoutes.scala`'s dead duplicate
  placeholder comment removed.
- **The non-blocking suggestion**: `OutputRepository.updateOwned`'s
  empty-body-PATCH-from-non-owner-grantee 200-vs-404 inconsistency fixed
  (was convenient to do alongside the CR1-CR3 work) — now genuinely
  guarded by a new regression test.

## NOT implemented this cycle (deferred to cycle 3, per the report's own
## acknowledgment that CR8 may slip)

- **CR4**: single-call transactional `POST /api/pipelines` (inline source |
  `sourceId`, `steps[]` with `parentStepId`, `outputs[]`, rollback tests)
  and `parentStepId` on step create / splice removed-placement count on
  step DELETE. This is the largest remaining deliverable and closes the
  rest of AC 1.
- **CR5**: `GET /api/outputs/:id/assertion-status` + alert-rule
  `targetOutputId` create/read (AC 6).
- **CR6**: `PublicDashboardRoutes` rewire off
  `findLastRunAtByOutputDataTypeId`; dropping `outputDataTypeId`/
  `outputDataTypeName` from `PipelineRepository`/`PipelineService`.
- **CR8** (explicitly lowest priority per the report): `GET
  /api/outputs/:id/rows`, `POST /api/pipelines/:id/preview`, `POST
  /api/pipelines/:id/validate-expression?stepId=`, the
  `pipeline-shapes/:id/expand` `{steps, outputs?}` breaking envelope +
  `parentStepId`, `DataSource.inferredSchema`, decision-15 server-owned
  panel layout, lean paginated `/api/outputs`+`/api/dashboards`,
  `config.format` (HEL-876), the `output-capabilities-response`/
  `preview-outputs-response` schemas.

## Gate results (fresh, this cycle)

- `sbt compile` / relevant `testOnly` runs: all green (see individual test
  output above); full non-parallel `sbt test` re-run at the end of the
  cycle (see the executor's final report for the pasted result).
- `check-schema-drift.mjs`: green (64 schemas / 48 protocol files —
  `NodeCapabilitiesProtocol` added); `DashboardProposalService.scala`/
  `helio-mcp/src/tools/proposal.ts` re-confirmed byte-for-byte untouched.
- `check-scala-quality.mjs`: clean (no new hard violations; `OutputRoutesSpec`
  crossed the 250-line soft-budget threshold as the evaluator predicted —
  noted, not split this cycle given the remaining CR backlog; a future
  cycle should split it per-route-family before it grows further).
- `openspec validate` / `check:openspec` / `check:spec-structure`: all
  green, unchanged from cycle 1.

---

# Cycle 3 (addressing evaluation-2.md, FAIL, 5/9 AC)

evaluation-2.md scored cycle 2 at 5/9 AC met and gave an explicit
critical-path order: fix the compute/"number" bug for real (AC 3), wire
HEL-892 into a live route (closes the rest of AC 2/3), assertion-status
(AC 6), then single-call `create_pipeline` (AC 1) if budget remains. This
is the last ordinary cycle per the orchestrator's `EXECUTION_CYCLES=3`
budget.

## Delivered (items 1-3 of the critical path)

- **Item 1 (real AC-3 closure)**: the cycle-2 sweep was scoped to
  `PipelineAnalyzeService` only and missed `ExpressionEvaluator.inferTypeOf`
  (the actual primary path `inferCompute` calls) emitting the same
  non-canonical `"number"`. Fixed. Doing the repo-wide re-sweep properly
  (not just the two lines the evaluator named) also surfaced TWO more real
  gaps: `inferCompute`'s legacy-fallback path and `inferCast`'s `casts` map
  both pass a caller-supplied config string straight into a `SchemaField`
  type with zero normalization — a caller writing `"double"`/`"long"`/
  `"date"` (all of which `CastStep.castValue` accepts as legitimate RUNTIME
  cast kinds) would silently produce a non-canonical schema type and vanish
  from `capabilities`' `columns`, the same bug class every other fix this
  ticket has made. Added `canonicalizeLegacyType` and applied it at both
  sites. `DemoData.scala`'s seed data fixed too. Every affected existing
  test assertion was corrected (never left red, never silently deleted);
  6 new regression tests added across `ExpressionEvaluatorSpec`/
  `PipelineAnalyzeServiceSpec`. Re-ran the repo-wide grep a THIRD time
  after all fixes to confirm no more non-canonical emitters remain in any
  `SchemaField`-producing path (the two remaining `"number"`/`"double"`
  hits, `ExpressionEvaluator.typeName` and the runtime cast dispatchers,
  are confirmed NOT schema-type producers).
- **Item 2 (HEL-892 as a real HTTP 400)**: `OutputBindingSpec
  .validateFieldMapping` is now called from `OutputService.create`/
  `update`, reading `config.fieldMapping` and validating its keys against
  the Output's own kind's slot set. `update` validates the MERGED config
  (post-patch), not the raw patch, so the write that would actually be
  persisted is what gets judged. 4 new `OutputRoutesSpec` tests.
- **Item 3 (assertion-status, AC 6)**: `GET /api/outputs/:id/assertion-status`
  implemented (`OutputService.assertionStatus`), keyed by the Output's own
  `NodeRef.stepId` (not the whole run) — a raw-source Output (`stepId =
  None`) is always `invalid = false` (no `assert` step exists to fail).
  Scoped to the pipeline's latest PERSISTED run; confirmed a dry run
  persists no `pipeline_runs` row at all (`PipelineRunService`'s own
  invariant), so no separate dry-run filter is needed — this simplifies
  on, and slightly corrects, the retired DataType-keyed version's doc
  comment. Renamed `AssertionStatusResponse.dataTypeId` → `outputId`
  (+ the matching `output-assertion-status.schema.json` update,
  `check:schemas` still green — schema and case class were both dead
  scaffolding with the old field name, no live producer to break). The
  alert-rule `targetOutputId` create/read half of AC 6 was ALREADY
  implemented and tested by a prior ticket (`AlertRuleService`,
  `AlertRuleRoutesSpec`) — confirmed by inspection, no new work needed.
  5 new route tests: raw-source no-op, passing run, failing run, a
  DIFFERENT step's failure not leaking onto this Output (proves the
  `stepId`-scoping is real, not accidental), and the ACL triad.

## NOT attempted this cycle (item 4, per the report's own instruction)

Per the report's explicit instruction, item 4 (single-call transactional
`POST /api/pipelines`) was NOT attempted this cycle — items 1-3 consumed
the cycle, and the report was clear that closing AC 1/3/6 cleanly mattered
more than spreading thin across item 4 too. This is a deliberate choice
following the report's own priority order, not a time-management failure
partway through item 4.

## Deferred (unchanged from cycle 2, still not attempted)

CR4 (single-call `create_pipeline` + `parentStepId` + splice
removed-placement count), CR6 (`PublicDashboardRoutes` rewire off
`findLastRunAtByOutputDataTypeId`, dropping `outputDataTypeId`/
`outputDataTypeName`), and the rest of CR8 (rows, preview,
validate-expression, shapes-expand envelope, `inferredSchema`, decision-15
layout, lean pagination, `config.format`, remaining schemas).

## AC status estimate (per the evaluator's own framing, not self-graded)

AC 2 and AC 3 should now be fully closed (compute bug fixed for real,
HEL-892 is a real HTTP 400, HEL-644/895/638 all tested). AC 6 should be
closed (assertion-status + the pre-existing alert-rule path). AC 1 remains
partially open (Output CRUD + capabilities ACL/transaction covered;
single-call `create_pipeline`'s own transaction/rollback is not). AC 5,
7, 8, 9 unchanged from cycle 2's PASS. Final grading is the evaluator's
call, not mine.

## Gate results (fresh, this cycle)

- `sbt compile`: clean. Individual `testOnly` runs for every touched
  suite: green (pasted in the executor's report). Full non-parallel
  `sbt test`: see the executor's final report for the pasted result.
- `check-schema-drift.mjs`: green (`AssertionStatusResponse`'s field
  rename stayed in sync with the schema update); proposal files
  re-confirmed untouched.
- `check-scala-quality.mjs`: clean, no new hard violations.
- `openspec validate`/`check:openspec`/`check:spec-structure`: all green,
  unchanged.
- HEL-910 sweep + the separate `"number"`/`"double"` repo-wide sweep: both
  clean.

---

# Cycle 4 (addressing evaluation-3.md, FAIL, AC 6/9)

## CR1: dry-run assertion-status bug (real regression, fixed)

`OutputService.assertionStatus`'s premise ("a dry run persists no `pipeline_runs` row") was
FALSE -- `insertDryRunInternal` writes a real row with `status = "dry_run"`, and
`listByPipelineInternal` has no status filter. Fixed: `runs.find(_.status != "dry_run")`
replaces the old `.headOption`. Both false comments (`OutputService.scala`'s premise comment,
and the earlier claim that had been silently reinstated) retracted and replaced with a comment
stating the CORRECT, verified fact with a pointer to `insertDryRunInternal`/
`deleteOldDryRunsInternal`/`onDryRunSuccess`. `PipelineProtocol`'s and the schema's own
"latest NON-DRY run" wording was already accurate (it described the INTENDED behavior, which
now actually holds) -- no change needed there once the code caught up to it.

New regression test (`OutputRoutesSpec`, "a later dry run's failing assertion is never
reported"): seeds a passing REAL run, then a FAILING dry run with a LATER `startedAt`. Before
the fix this test fails (`.headOption` on the desc-sorted unfiltered list picks the dry run);
after the fix it passes.

## CR2: the construction-site sweep (checkable enumeration, not a summary)

Every `SchemaField(` construction site in `backend/src/main/scala/`, found by
`grep -rn "SchemaField(" backend/src/main/scala/ | grep -v /test/`, classified:

| # | Site | Verdict |
|---|---|---|
| 1 | `PipelineAnalyzeService.scala:14` | Case class definition itself. N/A. |
| 2 | `PipelineAnalyzeService.scala:358` (`inferCompute`, validation-failure branch) | **Was a live bug** (cycle 3 partial fix). Now routes through `canonicalizeLegacyType`. Fixed. |
| 3 | `PipelineAnalyzeService.scala:362` (`inferCompute`, `inferType`-failure fallback) | **Was a live bug** (cycle 3 fix). Routes through `canonicalizeLegacyType`. Fixed (cycle 3). |
| 4 | `PipelineAnalyzeService.scala:394` (`inferAggregate`, `groupBy`) | **Live bug, found this cycle (CR2).** Caller-supplied `type` string passed straight through. **Fixed cycle 4**: `canonicalizeLegacyType` applied. Regression test added. |
| 5 | `PipelineAnalyzeService.scala:407` (`inferAggregate`, `aggResultType`) | Was a live bug (cycle 2 fix, `sum`/`avg` -> `"float"`). Already fixed. |
| 6-8 | `PipelineAnalyzeService.scala:433,467,504` (splittext/extractheadings/chunkbytokencount `indexField`/`levelField`/`tokenCountField`) | Hardcoded literal `"integer"` -- already canonical. Safe. |
| 9 | `PipelineAnalyzeService.scala:529` (`inferDateBucket`) | Was a live bug (cycle 3 fix, `"date"` -> `"timestamp"`). Already fixed. |
| 10 | `PipelineAnalyzeService.scala:560` (`inferPivot`, index fields) | Passthrough of an EXISTING (already-canonical, persisted) input-schema field's own `.type`. Safe -- not a new caller-supplied string. |
| 11 | `PipelineAnalyzeService.scala:593` (`inferWindow`, `outputColumn`) | `outputType` is computed by `inferWindow`'s own `function match` (hardcoded `"integer"`/canonicalized `"float"`/passthrough of an existing field's type/`"string"` fallback) -- already fixed cycle 3 (`running_sum` -> `"float"`). Safe. |
| 12-13 | `PipelineAnalyzeService.scala:627,631` (`inferUnpivot`, idFields/varName) | Passthrough of existing field types / hardcoded canonical `"string"`. Safe. |
| 14 | `PipelineAnalyzeService.scala:632` (`inferUnpivot`, valueName) | `valueType` derived from a SET of existing (already-canonical) field types, falling back to canonical `"string"` on a mixed set. Safe. |
| 15 | `PipelineAnalyzeService.scala:657` (`inferStringOps`, `outputColumn`) | Hardcoded literal `"string"`. Safe. |
| 16 | `PipelineAnalyzeService.scala:676` (`inferFillNull`?) | Hardcoded literal `"string"`. Safe. |
| 17-18 | `PipelineSchemaDrift.scala:43-44` | Passthrough of existing (already-persisted, already-canonical) baseline/current schema map values, for a drift-diff report. Safe. |
| 19 | `DemoData.scala:44` | Hardcoded literal seed data. Fixed cycle 3 (`"number"` -> `"float"`). |
| 20 | `PanelCapabilityService.scala:96` | `c.dataType` is `PanelCapabilityColumnResponse.dataType`, itself built earlier via `DataFieldType.asString`/`fromString` filtering -- already canonical by construction. Safe. |
| 21 | `PipelineRunService.scala:681` | `DataFieldType.asString(f.dataType)` -- explicit canonical conversion. Safe. |
| 22 | `PipelineService.scala:594` (analyze-proposal inline static-source dry-analyze) | **Live bug, found this cycle (CR2, evaluator-named).** `c.\`type\`` caller-supplied, unnormalized. **Fixed cycle 4**: routes through `DataFieldType.canonicalizeLegacy`. Regression test added (`PipelineAnalyzeProposalRoutesSpec`). |
| 23 | `PipelineService.scala:606` (`toSchemaFields`) | `DataFieldType.asString(f.dataType)` -- explicit canonical conversion from a typed `InferredField`. Safe. |
| 24 | `SchemaInferenceFacade.scala:28` (`toSchemaFields`, override branch) | **Live bug, found this cycle (CR2, NOT evaluator-named -- found by doing the enumeration properly).** `ov.dataType` (`FieldOverridePayload`) caller-supplied, unnormalized, feeds `SourceService.createSql`/`createRest`'s and `CreateSourceEnvelope`'s inferred-schema write. **Fixed cycle 4.** Regression test added (`SchemaInferenceFacadeSpec`). |
| 25 | `DataSourceService.scala:125` (`createStatic`) | **Live bug, found cycle 3, verified again this cycle.** Fixed cycle 3 (part of the earlier producer fix), confirmed still correct. |
| 26 | `DataSourceService.scala:175` (`createCsv`, override branch — same shape as #24 but NOT yet migrated onto `SchemaInferenceFacade`) | **Live bug, found this cycle (CR2, NOT evaluator-named).** Same `ov.dataType` caller-supplied-override pattern as #24, in the still-separate hand-rolled copy. **Fixed cycle 4.** Regression test added (`DataSourceServiceSpec`, would need its own dedicated case if `createCsv` gets one later -- deferred, see below). |
| 27 | `DataSourceService.scala:237` (`createTextUrl`?) | `DataFieldType.asString(f.dataType)` on an `InferredField`. Safe. |
| 28-31 | `DataSourceService.scala:316,406,491,784` (`ContentSourceSupport.metadataFields`/`pdfFields`/image-ingestion helpers) | All route through `DataField(..., DataFieldType.asString(...), ...)` internally -- verified by reading `ContentSourceSupport.metadataFields`'s source, every field is a hardcoded canonical constant via `asString`, never caller input. Safe. |

**Net: found and fixed 5 live bugs this cycle** (sites #4, #22 were evaluator-named; #24, #26
were found only by doing the full enumeration, not the string grep the evaluator warned
against). Re-ran the FULL enumeration a second time after all fixes (identical list above,
verdicts unchanged) to confirm no new gap was introduced by the fixes themselves.

**Deferred, noted but not fixed this cycle**: `DataSourceService.createCsv`'s override path
(#26) is a hand-rolled duplicate of `SchemaInferenceFacade.toSchemaFields` (#24) that a prior
ticket (HEL-473) apparently didn't finish migrating -- both are now individually
canonicalization-safe, but the duplication itself is a pre-existing code-quality issue outside
this ticket's scope; flagging as a spinoff candidate, not fixing inline (CONTRIBUTING.md:
"surface non-trivial findings as spinoff candidates rather than fixing inline during a focused
change" -- a full dedupe touches `createCsv`'s whole ingestion path and its own test suite).

## CR3: RLS-vacuity doc note

Added to `PipelineCapabilitiesRoutesSpec`'s class doc comment: explicit statement that its
`DbContext(db, db)` is superuser-on-both-pools and proves nothing about Postgres RLS policies
specifically (only the explicit app-level ACL predicate `pipelineRepo.findByIdShared` uses is
exercised for real) -- points to `OutputRoutesSpec`'s `helio_app_test_output_routes`
non-superuser role setup as what genuine RLS evidence looks like.

## CR4 (item 4, room permitting): single-call transactional `POST /api/pipelines` -- STARTED

Implemented and tested (5 new tests in `PipelineCreateTransactionalSpec`, all green):

- `CreatePipelineRequest` extended additively with `steps: Vector[CreatePipelineTransactionalStepRequest]`
  and `outputs: Vector[CreatePipelineTransactionalOutputRequest]` (both default-empty). A
  **hand-rolled JSON reader** replaces the `jsonFormat5` macro -- spray-json's macro does NOT
  apply a case class's Scala default for a missing NON-`Option` field (only `Option` fields
  default to `None`), so a naive `jsonFormat5` would have broken every pre-existing
  `{name, sourceDataSourceId, tag}` caller with zero `steps`/`outputs` key. Caught by 3 existing
  tests failing on the first attempt (`PipelineAclSpec`/`ResourceTaggingSpec`) -- fixed before
  proceeding, not silently left red.
- New schemas: `create-pipeline-request.schema.json`,
  `create-pipeline-transactional-step-request.schema.json`,
  `create-pipeline-transactional-output-request.schema.json` (task 1.2's `create-pipeline-request`
  half; the OTHER half of task 1.2 -- `parentStepId` on the EXISTING per-step
  `create-pipeline-step-request.schema.json` / `POST /api/pipelines/:id/steps` route, task 3.2 --
    intentionally deferred, see below).
- `PipelineService.create` extended: when `steps`/`outputs` are both empty, behavior is
  byte-identical to before (verified: `PipelineAclSpec`/`ResourceTaggingSpec`/`PipelineStepRoutesSpec`
  all still pass unmodified, 90/90). When non-empty, builds every step in array order (resolving
  `parentStepId` against earlier `clientId`s in the SAME request -- an unresolvable reference is
  a 400, tested) then every Output (resolving `nodeStepClientId` the same way; HEL-892's
  `validateFieldMapping` applies here too, tested). **Atomicity is a compensating-delete
  rollback (`pipelineRepo.delete` on any failure, cascading via V23/V94's `ON DELETE CASCADE`),
  NOT one literal Slick transaction spanning `PipelineRepository`/`PipelineStepRepository`/
  `OutputRepository`** -- documented explicitly in `PipelineService.create`'s doc comment, and
  flagging it here too rather than letting the ticket's literal "one Slick transaction" wording
  go unaddressed. This mirrors `PipelineProposalService.apply`'s own established
  compensating-rollback pattern for the identical problem (already in production, already
  reviewed) rather than inventing new transaction-composition plumbing across three
  independently-transactional repositories -- doing the latter correctly would mean threading a
  single shared `DBIO`/connection through all three repos' `ctx.withUserContext`/
  `withSystemContext` calls, a much larger and riskier change than this cycle's remaining budget
  should spend on unreviewed. Observable behavior (all-or-nothing on failure) is verified by the
  two rollback tests (bad step type; bad Output fieldMapping) and the parentStepId-resolution
  test, all green.

**Explicitly NOT done this cycle (still open under CR4)**:
- Task 3.2: `parentStepId` on the EXISTING `POST /api/pipelines/:id/steps` route (`addStep`/
  `persistNewStep`'s trunk-anchoring/splice logic) and the step-DELETE splice
  removed-placement-count report. Deliberately not touched -- `persistNewStep`'s existing
  splice/position semantics are intricate and heavily tested (`PipelineStepRoutesSpec`, 1497
  lines); extending it safely needs its own focused pass, not a rushed addition alongside CR4's
  new endpoint.
- A literal single-Slick-transaction implementation (see above -- compensating-delete substitutes
  for it, documented as a deliberate choice, not a silent gap).
- Inline source variant (`source: {...}` instead of `sourceDataSourceId`) for the single-call
  endpoint -- ticket's task 3.1 lists "inline source | sourceId" as an alternative; only
  `sourceDataSourceId` (existing source reference) is supported this cycle. `PipelineProposalService`
  already has inline-source-creation logic (`resolveSource`) that a future cycle should reuse
  rather than duplicate.

## Coordinator ruling acknowledged

Per the coordinator's explicit instruction: CR4 (now partially done) and CR6
(`PublicDashboardRoutes` rewire + `outputDataTypeId` drop, NOT started this cycle) remain
carried obligations for a future cycle, not reframed as a follow-up ticket or dropped AC by
this executor. That scope-split decision is the human's to make at escalation, not mine.

## Gate results (fresh, this cycle)

- `sbt compile`: clean. `testOnly` for every touched suite (`OutputRoutesSpec`,
  `PipelineAnalyzeServiceSpec`, `DataSourceServiceSpec`, `SchemaInferenceFacadeSpec`,
  `PipelineAnalyzeProposalRoutesSpec`, `PipelineCapabilitiesRoutesSpec`, `PipelineAclSpec`,
  `ResourceTaggingSpec`, `PipelineStepRoutesSpec`, `PipelineCreateTransactionalSpec`, and a
  953-test sweep across `com.helio.api.routes.pipelines.*`/`com.helio.services.pipelines.*`/
  `com.helio.domain.engine.*`/`com.helio.services.sources.*`/`com.helio.domain.panels.*`): all
  green.
- Full non-parallel `sbt test`: see the executor's final report for the pasted result.
- `check-schema-drift.mjs`: green (67 schemas / 48 protocol files -- 3 new pipeline schemas +
  the `CreatePipelineRequest` field additions stayed in sync); proposal files re-confirmed
  byte-for-byte untouched.
- `check-scala-quality.mjs`: clean, no new hard violations.
- `openspec validate`/`check:openspec`/`check:spec-structure`: all green, unchanged.

---

# Cycle 5 (implementing the coordinator's two rulings from evaluation-4.md)

Both items below were ruled on by the human coordinator with the decision already made --
implementation only, no re-litigation.

## Ruling 1 (D3): real single Slick transaction, compensating-delete deleted

Deleted `PipelineService.createTransactional`'s cycle-4 compensating-delete implementation
entirely (not patched). Replaced with a genuine `.transactionally` DBIO chain:

- `PipelineRepository.createAction` (new): DBIO variant of the pipeline-row insert (the caller
  performs the `dataSourceRepo.findByIdOwned` ownership check as a separate `Future` BEFORE
  building this action -- a read, not a write, so it doesn't need to share the write
  transaction's atomicity).
- `PipelineStepRepository.insertInternalAction` (new): DBIO variant of `insertInternal`,
  extracted so it can compose into the caller's transaction instead of opening its own.
- `OutputRepository.insertInternalAction` (new): same extraction for Output inserts.
- `PipelineRepository.runTransactionally` (new): runs an arbitrary composed `DBIO` through the
  privileged pool's `DbContext.withSystemContext(action.transactionally)` -- the ONE call site
  that actually opens the transaction spanning all three repositories.
- `PipelineService.createTransactional`/`buildStepsAction`/`buildOutputsAction`: rewritten to
  compose ONE `DBIO[PipelineSummary]` (pipeline insert `flatMap` every step insert `flatMap`
  every Output insert) and run it through exactly one `runTransactionally` call. A business
  validation failure (bad step type, unresolvable `clientId` reference, invalid Output kind/
  `fieldMapping`) is signalled via `DBIO.failed(PipelineCreateValidationFailure(...))` (new
  exception class), which Slick's `.transactionally` rolls back on -- caught once, after the
  transaction completes, in a `.recover`.

**Mutation-tested, as instructed** ("break the transaction boundary and confirm a partial write
becomes visible, then restore it"): temporarily split `createTransactional`'s single composed
`DBIO` into TWO separate `runTransactionally` calls (pipeline insert as its own transaction,
then steps/Outputs as a second one). Re-ran "roll back the whole call... when a step has an
invalid type" -- it FAILED, with the pipeline row genuinely persisted (`Vector("Rollback on bad
step") contained element "Rollback on bad step"`), proving the test really does exercise the
transaction boundary. Reverted the mutation; all 5 tests pass again with the real single-
transaction implementation. (A note for whoever reads this next: removing only `.transactionally`
from `runTransactionally`, WITHOUT also splitting into two separate `db.run`/`runTransactionally`
calls, did NOT reproduce the partial-write bug in this Postgres/Slick/HikariCP setup -- the
composed `DBIO` chain still executed correctly as one atomic unit even without the explicit
`.transactionally` wrapper. The genuinely distinguishing mutation is splitting the composition
into separate top-level `db.run` calls, not removing `.transactionally` from one already-single
call. `.transactionally` is kept in the real implementation regardless, since it's Slick's
documented, explicit way to state transactional intent and is not itself harmful.) Added a
permanent raw-SQL count assertion (`select count(*) from pipelines where name = ...`) to the
rollback test, bypassing the repository layer entirely, as an extra belt-and-suspenders check.

Full pipeline-suite re-run (458 tests across
`com.helio.api.routes.pipelines.*`/`com.helio.services.pipelines.*`/
`com.helio.infrastructure.persistence.pipelines.*`): all green, confirming the pre-existing
simple-create path (`req.steps`/`req.outputs` empty) and every other pipeline/step/run
repository method are unaffected by the `insertInternalAction`/`createAction` extractions.

## Ruling 2 (AC-3): all four required pieces

1. **Boundary validation (400s, not just canonicalization)**: added
   `DataFieldType.validateAndCanonicalize` (canonicalizes known synonyms, THEN validates against
   `fromString`; `Left` names every valid type). Wired into:
   - `DataSourceService.createStatic` -- every column's `type` validated up front; any failure
     returns one `BadRequest` naming every offending column and its bad value, plus the full
     valid-type list. Nothing is persisted on failure (new test verifies this via a real
     `findAll` query). New regression test: `"banana"` -> 400 naming valid types.
   - `PipelineAnalyzeService.inferAggregate`'s `groupBy` entries -- restructured out of the
     generic `parseConfig` catch-all (which HEL-311 reserves for genuinely malformed/unparseable
     JSON) into its own explicit check, producing a `validationError` that names the specific bad
     field(s) and value(s) plus every valid type -- matching this file's existing convention for
     a targeted business-rule violation (e.g. `inferCompute`'s "Unknown field: X"), NOT the
     generic "aggregate config error" category. New regression test added.

   **Known scope note**: the ruling named exactly these two boundary call sites. Two OTHER live
   producers found in cycle 4 (`SchemaInferenceFacade.toSchemaFields`'s override branch,
   `DataSourceService.createCsv`'s separate override-branch duplicate) still only CANONICALIZE
   (no explicit 400 path) -- they are now protected by the structural guard below (a genuinely
   invalid override throws `IllegalArgumentException`, a fail-loud 500, rather than silently
   persisting a bad type), but do NOT yet return a clean, actionable 400 the way the two named
   boundaries do. Flagging this explicitly rather than silently claiming full parity across all
   four producers -- extending boundary validation there is mechanical (same
   `validateAndCanonicalize` call, propagating `Either` through `SourceService.createSql`/
   `createRest`/`CreateSourceEnvelope`'s Future chains) but touches more call sites than the
   ruling's named two, so left for a follow-up rather than expanding scope unilaterally.

2. **`enum` constraint in `schemas/`**: added `DataFieldType.CanonicalWireValues` (the one
   source of truth the `SchemaField` guard, `validateAndCanonicalize`'s error message, and every
   schema enum below all read from). Added the 7-value enum to every schema `type`/`dataType`
   property that represents a column's `DataFieldType` (verified each candidate by checking its
   producing Scala type before touching it -- several near-miss "type" fields turned out to be
   unrelated, e.g. `PipelineShapeCatalogEntryResponse`'s `dataType` is a coarse UI-param
   descriptor string like `"string[]"`/`"object[]"`, never a `DataFieldType`, and panel/edit
   "type" discriminators in `dashboard-proposal`/`patch-set` schemas are unrelated
   PanelType/EditTarget-kind strings):
   - `schemas/pipelines/pipeline-analyze-response.schema.json` (`$defs.SchemaField.type`)
   - `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` (`$defs.SchemaField.type`)
   - `schemas/outputs/output-schema-field.schema.json` (already had the enum, cycle 1)
   - `schemas/sources/static-column-payload.schema.json` (new -- no schema existed for
     `StaticColumnPayload` before this cycle)
   - `schemas/sources/field-override-payload.schema.json` (new -- no schema existed for
     `FieldOverridePayload` before this cycle; `schemas/sources/` itself didn't exist)

3. **Real structural guard**: `SchemaField`'s primary constructor now `require`s
   `DataFieldType.fromString(type).isDefined` -- the ONE choke point every construction site in
   the codebase passes through, whichever of the (now 30, after the `inferAggregate` rewrite)
   `SchemaField(` sites it is. `SchemaFieldStructuralGuardSpec` (new) asserts this directly:
   every canonical value is accepted, `"number"`/`"banana"`/`""` all throw, and the exception
   message names every valid type. **This guard immediately caught a real bug in the test suite
   itself**: `PipelineAnalyzeServiceSpec`'s `baseSchema` fixture had been constructing
   `SchemaField("amount", "number")` since before this ticket even started (pre-existing,
   non-canonical test data) -- the guard aborted the entire suite on first load. Fixed the
   fixture to `"float"` and propagated the 8 downstream assertions that had been asserting the
   old wrong value verbatim (a real, previously-invisible drift the guard surfaced, not a new
   bug introduced this cycle).

4. **Dev DB check for already-persisted bad rows**: ran (read-only)
   ```sql
   select distinct jsonb_array_elements(inferred_schema)->>'type' from data_sources;
   ```
   against the shared local dev DB (`helio`, per `backend/.env`). Found **12 of 141
   `data_sources` rows** (query below) with an already-persisted `"number"` type entry --
   confirming the bug this whole ticket has been fixing was ALREADY producing bad data before
   this cycle's fixes landed:
   ```
   f6d9fa11-cc56-4600-9a3f-75b80026aebb | Skeptic Static                 | visits: number
   10e48aa0-1ded-4847-bed1-a74634d458f7 | HEL-328 smoke source (renamed) | amount: number
   0b1ddac5-7b7f-47c1-bf90-f597011b2901 | skeptic-src                    | amount: number
   f965b875-493f-4f28-a699-04829e7a3b3e | HEL-328 smoke source (renamed) | amount: number
   f563d4ef-9fb0-444d-96db-525c9ef5f5bc | Probe Source                   | x: number
   ab1c8c04-ec2b-496e-9698-770935a05082 | HEL-328 smoke source (renamed) | amount: number
   56085581-4d0f-4d27-943d-b1c5e287a77f | HEL-328 smoke source (renamed) | amount: number
   e2634b7c-0f01-48ec-86a6-358d17b616f6 | HEL-328 smoke source (renamed) | amount: number
   79168920-71fe-4c26-8b2a-8299644deaf2 | Demo source                    | value: number
   47cf396b-7770-4f31-9623-a83c619b2ecf | HEL-315 offers src             | amount: number
   9626947d-b7f9-4a21-b6b1-ef1cb67e420a | HEL-328 smoke source (renamed) | amount: number
   7357cf18-815d-4e5f-8b63-16b7ec56be90 | Demo source                    | value: number
   ```
   All 12 rows are dev/test artifacts by name (skeptic/smoke-test/demo/probe sources from prior
   manual sessions), not real user data -- but per the ruling, this is noted rather than
   silently left invisible. **Not fixed by this executor**: this is a data migration, not a code
   change, and this session's tool access does not include Linear ticket creation from within
   the sandboxed backend/bash tooling used for this cycle's work. **Recommending a spinoff
   ticket be filed** (owner: whoever holds Linear access at the next checkpoint) to either
   backfill these 12 rows' `inferred_schema` (`number` -> `float`) or confirm they're safe to
   leave/delete as stale dev artifacts, and to check whether the SAME query against the
   PRODUCTION database is warranted before this ticket's PR merges.

   **Cycle 6 update: filed by the coordinator as HEL-932** (data fix for the 12 already-poisoned
   `data_sources` rows).

## Gate results (fresh, this cycle)

- `sbt compile`: clean.
- `SchemaFieldStructuralGuardSpec`, `DataSourceServiceSpec`, `PipelineAnalyzeServiceSpec`,
  `PipelineCreateTransactionalSpec`: all green (including the mutation-test transcript above).
- Full pipeline-suite targeted run (458 tests): green.
- Full non-parallel `sbt test`: see the executor's final report for the pasted result.
- `check-schema-drift.mjs`, `check-scala-quality.mjs`, `openspec validate`/`check:openspec`/
  `check:spec-structure`: see the executor's final report.

## Post-guard fallout: fixing what the structural guard found (still cycle 5)

Adding `SchemaField`'s `require` and running the FULL suite (not just targeted files) surfaced
real, previously-invisible issues -- exactly what the guard is for:

1. **A 6th live producer, found only by the full suite run**:
   `DataSourceService.applyStaticRefresh` (the STATIC REFRESH path -- distinct from `createStatic`)
   built `DataField(col.name, col.name, col.\`type\`, nullable = true)` directly from the
   caller-supplied `col.type` with ZERO canonicalization or validation -- not even cycle 4's
   canonicalize-only fix, which only ever touched `createStatic`. A refresh payload with
   `"number"`/`"double"` used to silently persist wrong; after the `require` guard landed, it
   started 500ing instead (`AuditMutationInstrumentationSpec`'s static-refresh tests, which
   happen to use `"number"` as their column type, caught this immediately). Fixed with the SAME
   `validateAndCanonicalize` + 400 treatment as `createStatic` (not just canonicalize, for
   consistency -- a refresh accepts the identical wire shape a create does). 2 new regression
   tests (`DataSourceServiceSpec`): canonicalize-on-refresh, reject-unrecognized-on-refresh
   (confirming the pre-refresh schema is untouched on rejection).
2. **`schemaFieldJsonFormat` (the JSON `Vector[SchemaField]` codec `data_sources.inferred_schema`
   and `pipelines.last_source_schema` both deserialize through) needed to become TOLERANT on
   read**: it's the read path for the 12 already-poisoned dev-DB rows found in the AC-3 dev-DB
   check above -- without canonicalizing on read, `require` would 500 on EVERY subsequent read
   of one of those rows (`GET /api/pipelines/:id/analyze`, the schema-drift baseline capture,
   etc.), converting quietly-wrong data into new outages for rows this same ticket already
   knows about. Made `read` canonicalize via `DataFieldType.canonicalizeLegacy` before
   constructing `SchemaField`; `write` is unaffected (every in-process value is already
   canonical by construction).
3. **9 pre-existing test fixtures across 4 files** (`PipelineAnalyzeServiceSpec`,
   `PipelineSchemaDriftSpec`, `PipelineStepRequiredConfigSpec`, `PipelineRunServiceSpec`,
   `PipelineAnalyzeRoutesSpec`) constructed `SchemaField`/asserted against a non-canonical
   `"number"`/`"double"` value that predated this entire ticket -- the guard aborted those
   suites outright on first load. All fixed to a canonical value (`"float"`), with downstream
   assertions updated to match (never silently deleted or loosened).

Full suite re-run after all fixes: 3438 -> (see final gate results below) tests, 0 failures.

## Cycle 6 (evaluation-5.md CR1/CR2/CR3, closing AC-3)

1. **Fixture-based invariant guard (CR1)**: added `SchemaFieldRealDumpInvariantSpec`, loading
   the real `hel904-real-dump.sql` scrubbed dump into a fully-migrated (through latest, i.e.
   post-V94) embedded Postgres, reading a representative real pipeline's (`manyStepsPipelineId`,
   the same real many-step pipeline `V94OutputsMigrationSpec` already documents) persisted
   source schema (`data_sources.inferred_schema`) and real `pipeline_steps` rows, and running
   them through the ACTUAL `analyzeNodes` production function (not a reimplementation) covering
   the trunk root AND every tail branch. Every field of every resulting projected schema is
   asserted against `DataFieldType.fromString` directly. Green on first run against the real
   data (source schema + all step outputs already canonical).
2. **Residual hole (CR1's callout) resolved**: `schemaFieldJsonFormat.read` previously still
   threw (500) for a persisted type that is neither canonical nor one of the four known legacy
   synonyms. Decision made and implemented: widened the read fallback to `StringType` with a
   loud warning log naming the row's raw value, rather than leaving the throw -- a read-only
   deserialization path should not be able to 500 on a stray future value. `write` unaffected.
   New spec `SchemaFieldJsonFormatTolerantReadSpec` covers pass-through/canonicalize/fallback
   for both a garbage string and an empty string.
3. **HEL-931/HEL-932 named (CR2)**: `tasks.md`'s AC-3 section now names HEL-931 as the deferral
   target for the compiler-enforced typed-`DataFieldType`/`SchemaField` refactor (this ticket's
   shipped mechanism is runtime boundary-validation + schema `enum`s + a constructor structural
   guard, deliberately not a type-level one), and HEL-932 as the filed ticket for the 12
   already-poisoned dev-DB rows (also cross-referenced here).
4. **`design.md` D3 amended (CR2)**: now describes the ratified option-(iii) design (real
   3-repository `DBIO` composition through one `runTransactionally`, compensating-delete deleted
   outright) instead of the pre-ratification sketch, plus the RLS-posture note below.
5. **RLS posture (CR3/CR-C) resolved**: default preference (per this cycle's brief) was
   `withUserContext` for the composed transaction; investigated and found infeasible --
   `PipelineStepRepository.insertInternalAction`/`OutputRepository.insertInternalAction` are
   `internal`/system-context-only by design, and `DBIO.transactionally` requires every action in
   one composed chain to run against the SAME `Database` handle, so a composed action cannot
   split app-pool/privileged-pool by sub-action. Kept `withSystemContext`, and added the inline
   justification comment `DbContext.withSystemContext`'s own scaladoc requires, at
   `PipelineRepository.runTransactionally`'s definition -- explaining the constraint and why
   ownership/ACL is still enforced (caller-stamped `ownerId`, pre-transaction
   `dataSourceRepo.findByIdOwned`). Also dropped the now-visibly-redundant inner
   `.transactionally` from `runTransactionally` (evaluation-5.md CR8/minor #8) -- confirmed via
   `DbContext.withSystemContext`'s own body (`privilegedDb.run(action.transactionally)`) that the
   wrap was already happening one level up.

Gates run this cycle (fresh): targeted new specs green (10/10 tests across
`SchemaFieldRealDumpInvariantSpec`/`SchemaFieldJsonFormatTolerantReadSpec`/
`SchemaFieldStructuralGuardSpec`), `sbt compile` clean,
`PipelineCreateTransactionalSpec` (5/5) re-verified green after the `runTransactionally`
signature change. Full non-parallel `sbt test` + remaining gates: see final report.

**Not reached this cycle** (budget ran out after the required items + CR-C): CR6
(`PublicDashboardRoutes` rewire off `findLastRunAtByOutputDataTypeId`, `outputDataTypeId`/
`outputDataTypeName` drop), task 3.2 (`parentStepId` on the existing steps route + DELETE splice
report), and all of CR8's remaining route surface (`validate-expression`, `rows`, `preview`,
`inferredSchema`/task 1.3, shapes-expand envelope, paginated lists, `config.format`, panel
layout, response schemas). These remain carried exactly as evaluation-5.md's critical path
listed them, now for a P1.3b follow-up ticket (per evaluation-5.md's own suggested clean split
point) rather than a further cycle 6 extension, since EXECUTION_CYCLES is exhausted this cycle.

## Cycle 7 (evaluation-6.md: RLS empirical experiment + P1.4-dependency route surface)

**RLS empirical experiment (coordinator-requested, resolved by observation not analysis):**
Cycle 6's `runTransactionally` used `withSystemContext` (RLS-bypassing privileged pool) on
the strength of analytical reasoning that the composed `*Internal` insert actions "required"
it. Actually tried `withUserContext` this cycle against a REAL non-superuser RLS-enforced app
pool (`PipelineRepositoryRunTransactionallyRlsSpec`, mirroring `OutputRoutesSpec`'s role setup
-- the earlier `PipelineCreateTransactionalSpec` fixture uses the SAME superuser connection for
both pools and proves nothing about RLS). **Observed result: it works unmodified.**
`pipeline_steps_owner`'s RLS `USING` clause and `outputs_insert`'s `WITH CHECK` clause both key
off `current_setting('app.current_user_id')`/`owner_id`, and every row this composed chain
writes carries the SAME authenticated user id `withUserContext` sets that session variable to
-- no RLS check ever fires against a mismatched id in this specific write shape. Switched
`runTransactionally`/`createTransactional` to `withUserContext(user.id)` permanently -- this now
gets atomicity AND RLS enforcement together, removed the bypass-justification comment
entirely (there is no bypass anymore), and dropped the double-wrapped `.transactionally`. Full
458-test pipeline suite + the new RLS spec, all green; full 3479→3487-ish suite (see final gate
results) confirms no regression.

**Route surface (ordered by the coordinator's explicit P1.4-dependency priority):**

1. **`GET /api/outputs/:id/rows`** (P1.4's `get_output_rows`): added `NodeSnapshotRepository.listRowsPaged`
   (offset/limit + total count, alongside the existing `listRows`), `OutputService.rows` (ACL via
   the SAME `outputRepo.findById` sharing-aware select `GET /api/outputs/:id` uses; nullable
   `nodeSnapshotRepo` degrades to an empty page), and the `GET /outputs/:id/rows` route. 4 tests:
   full ACL triad + paginated content, offset/limit, negative-offset 400, empty-snapshot 200.
2. **`POST /api/pipelines/:id/preview?outputId=`** (P1.4's `preview_outputs`): extracted
   `PipelineRunService.previewStep`'s body into a shared `previewAtNode(pipelineId, targetStepId:
   Option[String], user)` helper (also handles `targetStepId = None`, i.e. an Output bound
   directly to the raw source -- `previewStep` itself never had to handle that case since a
   `stepId` is always present on its path). `previewOutput` resolves the Output via
   `outputRepo.findById` (sharing-aware; also rejects an outputId belonging to a DIFFERENT
   pipeline than the path's), then delegates to `previewAtNode`. Never mutates run state --
   proven by a REAL test at both the service layer (`PipelineRunServiceSpec`: runs a real submit
   on a SEPARATE pipeline in between, proving the assertion mechanism can actually detect a
   mutation, then confirms THIS pipeline's own state is untouched) and the HTTP layer
   (`OutputRoutesSpec`). 3 service tests + 3 HTTP tests (full ACL triad, 404 unknown outputId,
   run-state-unchanged).
3. **Task 3.2** (`parentStepId` on the existing per-step route): `CreatePipelineStepRequest.parentStepId`
   (optional, precedence over `position`) validated against the pipeline's own steps then spliced
   via the existing `spliceInsertAtInternal` primitive. `DELETE /api/pipeline-steps/:id` now
   returns `200 DeletePipelineStepResponse(removedTailStepCount)` instead of a bare `204` --
   `deleteInternal`'s already-computed splice-on-delete count (previously discarded) surfaced.
   **Every pre-existing test asserting `204` on this route was updated to `200` + the new body**
   (5 call sites across `PipelineStepRoutesSpec`/`PipelineAclSpec`), never left red. New tests:
   parentStepId splice (persisted-parent verification -- `PipelineStepResponse` carries no
   `parentStepId` field, so verified via a raw SQL read), parentStepId-not-in-this-pipeline 422,
   and a raw-SQL-seeded real branch point proving `removedTailStepCount = 2` on delete (the
   per-step POST route's OWN splice semantics can never create a genuine branch -- every insert
   there reparents the anchor's existing children onto the new step -- so a raw-SQL seed was the
   only way to set up an actual branch point for this assertion).
4. **`POST /api/pipelines/:id/validate-expression?stepId=`**: extracted `capabilitiesAtNode`'s
   node-schema-resolution logic into a shared `projectedSchemaAtNode` helper, delegates to
   `ExpressionEvaluator.validate` against the target node's field names. 5 tests: valid
   expression (stepId absent), unknown field naming it, node-scoped validation (a select-dropped
   column fails validation at that node but not at the source), unknown-stepId 404, full ACL
   triad.
5. **`POST /api/pipeline-shapes/:id/expand`** `{steps, outputs?}` envelope (BREAKING): interpreted
   "accept a parentStepId target" as response-side chaining metadata (`clientId`/`parentStepId`
   per entry, `"step-0"`/`"step-1"`/... in expansion order, mirroring
   `CreatePipelineTransactionalStepRequest`'s convention exactly) rather than a request-side field
   with nothing to anchor into (`ExpandPipelineShapeRequest` carries no `pipelineId` at all --
   `pipeline-shapes` is a pipeline-agnostic template catalog). `outputs: Option[JsArray] = None`
   for every shape today (no shape declares one yet -- forward-compatible wire shape, not a
   populated field). Updated every existing `PipelineShapeRoutesSpec`/`ApiRoutesSpec` assertion
   reading the old bare-array shape (2 call sites), never left red. 2 new tests (single-step +
   multi-step chaining). **Known, deliberately-unfixed consumer break** (contracts-only scope):
   `frontend/src/features/pipelines/**` (4 files), `frontend/.../pipelineService.test.ts`,
   `e2e/hel399-shape-instantiate.spec.ts`, `helio-mcp/src/{tools/write.ts,helioApi.ts,types.ts}`
   all still expect the bare-array response and will break at RUNTIME against this backend
   change -- named explicitly in `tasks.md` rather than silently discovered later.
6. **`GET /api/outputs`** (task 2.6, absorbs HEL-722): `GET /api/dashboards` was ALREADY
   paginated (verified, no change needed). Added the actual gap -- `OutputService.listAll` +
   route, owner-scoped (mirrors `OutputRepository.findAllByOwner`'s existing shape; NOT
   sharing-aware, unlike `GET /pipelines/:id/outputs`). 3 tests: owner-only scoping (a
   grantee-owned Output on the same pipeline does not leak into the owner's list), offset/limit,
   negative-offset 400.

**Documentation honesty fix**: `ApiRoutesSpec`'s stale "dataAsOf null for every panel (the
feature is retired, task 4.1)" test title/comment was corrected -- cycle 6 rewired `dataAsOf`
back onto `panel -> output -> pipeline.lastRunAt` for `OutputPanel`-kind placements, so the
feature is NOT retired; that specific test still holds because it only exercises a `text` panel
(no output binding), not because the feature is dead. Left the test's own assertion unchanged
(still correct); fixed only the misleading title/comment.

**Not reached this cycle** (budget spent on the 6 P1.4-priority items + the RLS experiment,
per the coordinator's own explicit ordering): `DataSource.inferredSchema` on `DataSourceResponse`
(task 3.10 + schema task 1.3 -- `DataSourceResponse` is a multi-subtype discriminated union;
this is a real, moderately mechanical change spanning every subtype + every `fromDomain` call
site, deliberately not rushed with the remaining budget), decision-15 server-owned panel-layout
defaults (task 2.7), `config.format`/HEL-876 (task 2.3b), and the
`output-capabilities-response`/`preview-outputs-response` schemas (rest of task 1.1). These are
the sole remaining gaps against AC 1's full route surface.

Gates run this cycle (fresh): `sbt compile` clean; `check-scala-quality.mjs` clean (4 inline-FQN
violations found and fixed, then reverified clean, 136 pre-existing soft file-size warnings,
none new); targeted suite (`pipelines.*`/`domain.engine.*`/`ApiRoutesSpec`, 1122 tests) green;
full non-parallel `sbt test` (3479 tests before this cycle's fixes, re-run after -- see final
report for the exact post-fix count); `check-schema-drift.mjs` (97 entries, 72 schemas checked,
up from 95/70 -- 2 new schemas this cycle: `delete-pipeline-step-response`,
`validate-expression-request`/`expression-validation-response`); `openspec validate`/
`check:openspec`/`check:spec-structure` all green; proposal-file diff still empty.

## Cycle 9 (final-gate skeptic dimension-split: 2 real gaps + spec-vs-code drift corrections)

Four parallel opus skeptics ran a dimension-split final gate. Deletion-sweep CONFIRMed cleanly;
route/ACL, contract+schema, and wire-contract-diff all REFUTEd -- mostly spec-delta-vs-shipped-code
drift (the shipped code and tests themselves were sound), plus two real gaps fixed this cycle:

**Real gap 1 — false verification citation.** `PipelineRunService.previewAtNode`'s scaladoc cited
a nonexistent spec (`PipelinePreviewRunStateUnchangedSpec` -- confirmed absent by repo-wide grep).
The REAL run-state-unchanged test does exist (`PipelineRunServiceSpec`'s "does not mutate
last_run_status/last_run_at" test, added cycle 7, plus `OutputRoutesSpec`'s HTTP-level
equivalent) -- the citation just named the wrong file. Fixed the comment to name the real tests
rather than either deleting the claim or writing a duplicate test for something already covered.

**Real gap 2 — undisclosed second BREAKING change.** `DELETE /api/pipeline-steps/:id` went
`204 No Content` → `200 OK` + `{ removedTailStepCount }` (task 3.2, cycle 7) with no spec delta at
all -- the live baseline `openspec/specs/pipeline-steps-persistence/spec.md` still said 204.
Added a new `MODIFIED` delta for `pipeline-steps-persistence` disclosing the break explicitly.
Checked both real consumers of the prior `204` (`frontend/.../pipelineService.ts`'s
`deletePipelineStep`, `helio-mcp/src/helioApi.ts`'s `deletePipelineStep`) -- BOTH discard the
response body/status beyond "request succeeded" (neither reads `204` specifically nor parses a
body), so **this break has zero observed runtime impact on existing consumers**, unlike the
`expand` envelope change (whose consumers DO parse the response and DO break -- HEL-934). No
follow-up ticket filed for consumers; the spec delta documents this distinction explicitly, and
`helio-mcp/src/helioApi.ts`'s stale "every delete endpoint answers 204" comment block was
corrected (one-line-scoped honesty fix, since this ticket is the one that made that comment
false).

**`POST /api/pipelines/:id/preview?outputId=` optionality — flagged, not guessed through.** Code
requires `outputId`; the shipped spec delta and the ticket's own wording ("`?outputId=` scopes")
implied an optional all-Outputs variant. Assessed making it optional: would require a NEW
per-Output response envelope (today's response is the pre-existing single-node
`RunResultResponse`) plus de-duplicating preview computation across Outputs sharing the same
node -- real, non-trivial scope, not a doc fix. Rather than guess, fixed the spec delta to
describe what actually shipped (outputId required, single-node `RunResultResponse`) as the
lower-risk default, and flagged the all-Outputs variant as an explicit, named, unresolved
decision in the spec delta itself for the coordinator to rule on.

**Spec-vs-shipped-code drift, corrected (specs rewritten to describe what shipped, not what was
originally planned):**
- `pipeline-shape-registry/spec.md`: removed the request-side `parentStepId` field (shipped
  request is `{params}` only -- chaining is response-side, per design.md D14's already-correct
  rationale, now also stated in the spec itself); corrected `steps` entries to
  `{clientId, kind, config, parentStepId}` (was `{kind, config}`); deleted the two
  OutputContract-returns-an-outputs-block scenarios (unimplementable -- `OutputContract` is
  `{rowCount, description}` only, `fromDomain` hardcodes `outputs = null`); added a
  multi-step-chaining scenario matching the real shipped test.
- `pipeline-create-api/spec.md`: corrected `sourceId`-or-inline-source to the shipped
  `sourceDataSourceId` (required, no inline variant); corrected `steps[]`/`outputs[]` field names
  to the shipped `clientId`/`parentStepId`/`nodeStepClientId`; corrected the response to the
  shipped bare `PipelineSummaryResponse` (no step/Output ids). Flagged the inline-source variant's
  absence as a genuine unfiled gap (unlike the four HEL-933 items, it was never added to design.md
  D13's list or filed) -- named explicitly in the spec for the coordinator to decide on filing.
- `output-routes-api/spec.md`: (a) `?page=&pageSize=` → `?offset=&limit=` for `GET
  /api/outputs/:id/rows`; (b) the lean list corrected from "sharing-aware" to owner-only
  (`findAllByOwner`), with a scenario proving a grantee-owned Output does not leak into the
  owner's own list; (c) corrected "404, never 403" to the shipped ACL split (403 for an
  authenticated non-grantee on CREATE, matching `PanelService.create`'s own convention; 404 for a
  non-owner grantee on PATCH/DELETE, RLS-invisible); (d) deleted the `config.format`/HEL-876
  requirement entirely (code was deferred to HEL-933, which will write its own delta).
- Deleted `dashboard-panel-layouts/spec.md` and `data-source-persistence/spec.md` from this
  change's specs/ entirely -- both describe wholly-unimplemented behavior (decision-15 layout,
  `inferredSchema` on data-source responses, both deferred to HEL-933/tasks 2.7 and 3.10+1.3);
  archiving them here would record a contract the API doesn't honor. HEL-933's own future change
  will write these fresh.

**Stale scaladoc (item 8), fixed:**
- `PipelineProtocol.scala`'s `CreatePipelineTransactionalStepRequest` doc said "compensating-delete
  rollback, not a single literal Slick transaction" -- the exact opposite of what shipped
  (ratified D3, single real transaction, compensating-delete deleted in cycle 5). Corrected.
- `PipelineService.scala`'s `createTransactional` doc still named `DbContext.withSystemContext` as
  the mechanism after cycle 7 switched it to `withUserContext` (the RLS empirical experiment).
  Corrected, with a note on why (RLS confirmed to work under the app pool).

**Flagged for the requesting agent to act on (not this executor's to do):**
- HEL-934's Linear description reportedly repeats the same false "OutputContract returns an
  outputs block" premise the spec delta had -- needs correcting there too (Linear edit, not a
  repo change).
- The `pipeline-create-api` inline-source-variant gap needs filing as its own follow-up ticket
  (flagged in the spec delta; filing is the coordinator's to do, per their own stated workflow).
- The preview `?outputId=` all-Outputs-variant decision (make it optional now vs. defer) is
  unresolved -- flagged above and in the spec delta for a ruling.

Gates run this cycle (fresh): `sbt compile` clean; targeted suite
(`pipelines.*`/`PipelineRunServiceSpec`, 304 tests) green; full non-parallel `sbt test` (see final
report for the exact count); `openspec validate output-routes-api-contracts --strict` → valid;
`openspec validate --all` → 340/340; `check:openspec`/`check:spec-structure` clean;
`check-schema-drift.mjs` unchanged (97/72, no schema shape changed this cycle — doc-only plus two
scaladoc comments); `helio-mcp` typecheck clean (one comment touched there).

## Cycle 10 (coordinator ruling: implement absent-outputId preview arm, not defer it)

The coordinator ruled on the flagged decision from cycle 9: `outputId` must be genuinely
optional on `POST /api/pipelines/:id/preview`, implemented now, because HEL-907 (P1.4) specifies
its MCP tool as `preview_outputs(pipelineId, outputId?)` -- narrowing the AC to "outputId
required" would relocate exactly the dependency problem `preview` was kept in this ticket to
avoid.

**Implementation**: `PipelineRunService.previewOutput` renamed to `previewOutputs(pipelineId,
outputId: Option[OutputId], user)`, returning a new uniform envelope,
`PipelinePreviewResponse{outputs: Vector[OutputPreviewEntry{outputId, preview: RunResultResponse}]}`,
in BOTH arms:
- `outputId` present: unchanged behavior from cycle 7/9, now wrapped in the one-entry envelope.
- `outputId` absent: ACL gated at the PIPELINE level (`pipelineRepo.findByIdShared`, since there
  is no single Output to resolve ACL through), lists every Output on the pipeline
  (`outputRepo.listByPipelineInternal`), computes each DISTINCT node's preview exactly ONCE
  (`Future.traverse` over `distinct` node keys, not once per Output -- `previewAtNode` re-runs
  the whole tree-walk engine from scratch, so this avoids redundant work for N Outputs sharing
  one node), then maps each Output back to its node's already-computed result. If ANY node's
  preview fails, the whole call fails with the first failure encountered (never a
  partially-populated envelope).

Route (`PipelineRunStatusRoutes`) changed `parameters("outputId")` to
`parameters("outputId".optional)`.

**Tests, both arms, at both layers** (the coordinator's own named risk: "that's exactly where a
mutation would be most likely to slip in given more work happens per call" for the all-Outputs
path):
- `PipelineRunServiceSpec` (10 tests total): single-Output arm (4, unchanged from cycle 7/9,
  updated for the envelope wrapper) + all-Outputs arm (6 new: every-Output preview, shared-node
  dedup proof via identical `preview.rows` across two Outputs on the same node, empty-Outputs
  pipeline returns `{outputs: []}`, its OWN dedicated run-state-unchanged test via a real
  separate-pipeline run, unknown-pipeline 404).
- `OutputRoutesSpec` (HTTP layer, 6 preview tests total): single-Output arm ACL
  triad+404+run-state-unchanged (unchanged from cycle 9, updated for the envelope) + all-Outputs
  arm ACL triad+empty-outputs+its OWN dedicated run-state-unchanged test.

**Schema**: added `schemas/pipelines/pipeline-preview-response.schema.json` (previously deferred
implicitly since task 3.7 wasn't done) -- resolves the "preview-outputs-response NOT added" note
task 1.1 carried since cycle 1; `design.md` D13 corrected to remove `preview-outputs-response`
from the P1.3b list (only `output-capabilities-response`, backing task 3.4, remains there).

**Spec**: `specs/pipeline-preview-api/spec.md` rewritten a second time (cycle 9's version
described `outputId` as required, matching the then-shipped code) to describe the NOW-correct
contract: `outputId` optional, uniform envelope in both arms, with scenarios for every-Output
preview, shared-node dedup, empty-Outputs, and run-state-unchanged IN BOTH ARMS explicitly.

**Doc citations fixed**: `PipelineRunService.previewAtNode`'s scaladoc (fixed for a false
citation in cycle 9) updated again to name `previewOutputs` (was `previewOutput`, the pre-rename
name) and to name BOTH per-arm tests, not a single describe block. `tasks.md` task 3.7 marked
done (it had never been checked despite the feature existing since cycle 7 -- an honesty gap
this cycle also closed, not introduced).

Gates run this cycle (fresh): `sbt compile` clean; `check-scala-quality.mjs` clean (no inline-FQN
violations, 137 pre-existing soft file-size warnings); targeted suite
(`pipelines.*`/`PipelineRunServiceSpec`, 367 tests) green; full non-parallel `sbt test` — 3490
tests, 0 failures; `check-schema-drift.mjs` (98 entries, 73 schemas checked, up from 97/72 --
the one new `pipeline-preview-response` schema); `openspec validate
output-routes-api-contracts --strict` → valid; `openspec validate --all` → 340/340;
`check:openspec`/`check:spec-structure` clean.

## Cycle 11 (round-2 final-gate skeptics: one real wire-vs-spec drift + one trivial wording fix)

**Real finding**: `specs/pipeline-shape-registry/spec.md`'s expand-response delta claimed
`{ steps: [...], outputs: null }` for the no-outputs case — not what's actually on the wire.
`ExpandPipelineShapeResponse.outputs: Option[JsArray] = None`, serialized via `jsonFormat2` on a
protocol trait that does NOT mix in spray-json's `NullOptions` (confirmed: `NullOptions` appears
nowhere in this backend) — the DEFAULT `OptionFormat` DROPS a `None` field from the JSON object
entirely rather than writing a literal `null`. So the real shipped response for every shape today
is `{"steps": [...]}` with NO `outputs` key at all — optional-key semantics (`outputs?`), not a
nullable-value field. Corrected the spec delta's wording throughout (requirement text + the
"Expand succeeds" scenario) to say the key is OMITTED, not present as `null`.

Added a raw-JSON assertion to `PipelineShapeRoutesSpec`'s "return 200 with {steps, outputs}..."
test, on the raw parsed `JsObject` BEFORE converting to the case class: asserts `steps` is present
and `outputs` is genuinely absent from `.fields.keySet`. This is the assertion that would have
caught the wrong "outputs: null" spec claim the first time — `resp.outputs shouldBe None` (the
pre-existing, case-class-level assertion) cannot distinguish "key omitted" from "key present as
null", since both deserialize to `None` on the Scala side.

**Trivial finding**: `specs/pipeline-create-api/spec.md`'s inline-source-variant gap note still
said "unfiled as of this writing" — corrected to reference HEL-933 (filed as an addendum there,
with its own acceptance criterion, per the coordinator).

Gates run this cycle (fresh): `sbt compile` clean; `check-scala-quality.mjs` clean; targeted spec
(`PipelineShapeRoutesSpec`, 7 tests) green; full non-parallel `sbt test` (see final report for the
exact count); `openspec validate output-routes-api-contracts --strict` → valid; `openspec
validate --all` → 340/340; `check:openspec`/`check:spec-structure` clean; `check-schema-drift.mjs`
unchanged (98/73 — no schema shape changed, doc + one test assertion only).

## Cycle 12 (round-3 final-gate skeptic: same wire-shape imprecision class, one more instance)

Same finding class as cycle 11, found by a class-wide sweep after that fix:
`specs/output-routes-api/spec.md`'s root-bound-Output-creation scenario said the response has
`nodeStepId` as `null`. `OutputResponse.nodeStepId: Option[String]` is serialized via
`jsonFormat10` on a protocol with no `NullOptions` mixed in anywhere in this backend — a
root-bound Output's `201` response OMITS the `nodeStepId` key entirely, never present as a
literal `null`. Corrected the requirement text and the "Owner creates an Output at the pipeline
root" scenario. Added the mirrored raw-JSON assertion to `OutputRoutesSpec`'s "let the owner
create an Output (200/201)" test (which already creates a root-bound Output, `CreateOutputRequest(None, ...)`)
— parses the raw response as a `JsObject` and asserts `nodeStepId` is absent from the key set
BEFORE converting to the case class, same pattern as cycle 11's `expand`/`outputs` fix.

Non-blocking, correctly left alone per the coordinator's own note: the round-3 skeptic also found
the same imprecision in `pipeline-list-api`'s and `pipeline-create-api`'s `lastRunStatus`/
`lastRunAt` "null" wording, but those are verbatim pre-existing text already on `main`, not
introduced by this change — not touched, per "don't churn unrelated pre-existing specs."

Gates run this cycle (fresh): `sbt compile` clean; `check-scala-quality.mjs` clean; targeted spec
(`OutputRoutesSpec`, 34 tests) green; full non-parallel `sbt test` (see final report for the exact
count); `openspec validate output-routes-api-contracts --strict` → valid; `openspec validate
--all` → 340/340; `check:openspec`/`check:spec-structure` clean; `check-schema-drift.mjs`
unchanged (98/73 — no schema shape changed, doc + one test assertion only).

## Cycle 13 (round-4 final-gate skeptic: exhaustive Option-field enumeration, third and final instance)

Same finding class as cycles 11/12, this time found by an EXHAUSTIVE enumeration of every
response-side `Option` field across this change's protocols (not another spot-check): the
skeptic confirmed exactly three such fields exist -- `OutputResponse.nodeStepId` (fixed cycle
12), `ExpandPipelineShapeResponse.outputs` (fixed cycle 11), and
`ShapeStepExpansionResponse.parentStepId` (this cycle). All request-side `Option`s were already
correctly documented under the absent-vs-null idiom.

`specs/pipeline-shape-registry/spec.md` described the first expanded step's `parentStepId` as
`null`. `ShapeStepExpansionResponse.parentStepId` is `Option[String]` via `jsonFormat4` with no
`NullOptions` mixed in anywhere in this backend -- the first step's response entry OMITS the
`parentStepId` key entirely. Corrected the requirement text (`parentStepId: String | null` →
`parentStepId?: String`) and both scenarios ("Expand succeeds..." and "Multiple expanded
steps...").

**Closed the test blind spot that let this pattern survive three rounds**: both
`PipelineShapeRoutesSpec` tests previously only asserted `resp.steps.head.parentStepId shouldBe
None` on the DESERIALIZED case class, which cannot distinguish "key omitted" from "key present as
null" -- exactly why cycles 11-13 kept finding the same class of drift. Added raw-`JsObject`
assertions to BOTH tests: the single-step test now also asserts the first step's raw entry has no
`parentStepId` key; the multi-step chaining test now asserts the FIRST raw entry omits the key
while the SECOND raw entry carries it as a real string (`JsString("step-0")`) -- proving the
omission is specific to "no parent" and not a blanket omission bug.

Gates run this cycle (fresh): `sbt compile` clean; `check-scala-quality.mjs` clean; targeted spec
(`PipelineShapeRoutesSpec`, 7 tests) green; full non-parallel `sbt test` (see final report for the
exact count); `openspec validate output-routes-api-contracts --strict` → valid; `openspec
validate --all` → 340/340; `check:openspec`/`check:spec-structure` clean; `check-schema-drift.mjs`
unchanged (98/73 — no schema shape changed, doc + test assertions only).

Per the skeptic's own framing, this closes the Option-field-omission-vs-null finding class for
good -- no further instances remain to hunt for.
