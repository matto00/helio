# Files modified — CS2c-3a backend-pipeline-step-adt

## Backend — domain

- `backend/src/main/scala/com/helio/domain/Pipeline.scala` (NEW, 189L) — sealed-trait `PipelineStep` + 10 subtypes + per-subtype `*Config` case classes + `PipelineStepKind` discriminator helper.
- `backend/src/main/scala/com/helio/domain/PipelineStepHandlers.scala` (NEW, 311L) — typed per-kind handler functions extracted from the in-process engine. Includes the shared value/coercion helpers (`anyToJsValue`, `toDouble`, etc.) that used to live on the engine class.
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` (MOD, 145L, was 456L) — thin sealed-trait dispatcher; per-kind logic moved to `PipelineStepHandlers`; CSV loader retained.
- `backend/src/main/scala/com/helio/domain/model.scala` (MOD, 294L, was 300L) — pre-CS2c-3a flat `PipelineStep` case class removed; pointer comment added.

## Backend — protocol

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` (NEW, 176L) — per-domain protocol trait + `PipelineStepResponse` sealed trait with per-subtype response case classes + discriminated-union `RootJsonFormat` + `CreatePipelineStepRequest` / `UpdatePipelineStepRequest` typed shapes.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` (NEW, 170L) — typed `decode(kind, raw)` / `encodeConfig(config)` / `encode(step)` for DB round-trips. Tolerance helpers for filter / compute / aggregate configs that legacy rows may have persisted partial.
- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` (MOD, 235L, was 143L) — pre-CS2c-3a `CreatePipelineStepRequest` / `UpdatePipelineStepRequest` / `PipelineStepResponse` / `AnalyzeStepResponse` removed; analyze response evolved to discriminated union (`AnalyzeStepResponse` sealed trait + 10 per-subtype case classes + `RootJsonFormat` dispatcher).
- `backend/src/main/scala/com/helio/api/package.scala` (MOD, 173L) — removed the `val AnalyzeStepResponse` re-export (sealed trait has no companion); kept the type alias.

## Backend — infrastructure

- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` (MOD, 138L, was 80L) — `listByPipeline` / `findById` now return typed `PipelineStep`; `rowToDomain` dispatches on `op` column via codec; `insert` / `update` accept typed configs; `domainToRow` flattens the subtype via codec.

## Backend — services

- `backend/src/main/scala/com/helio/services/PipelineService.scala` (MOD, 296L, was 202L) — `AllowedOps` removed; `addStep` / `updateStep` accept typed configs (parsed at the protocol boundary); cross-type PATCH lock implemented (400 with descriptive message). `analyze` re-encodes the typed config to JSON text before handing to `PipelineAnalyzeService`, then maps the analyze output back to typed wire shape via `PipelineStepConfigCodec`.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (NEW, 306L) — extracted run-lifecycle logic from `PipelineRunRoutes`. Owns `submit` (pre-execution + dispatch + SSE event publication + result fetch), `previewStep`, `status`, `history`, and the SSE registry handle.
- `backend/src/main/scala/com/helio/services/ServiceError.scala` (MOD, 32L, was 28L) — added `UnprocessableEntity` variant for the 422 paths the run service emits.
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` (MOD, 57L) — added `UnprocessableEntity` → 422 mapping in `completeError`.

## Backend — routes

- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` (DELETED, was 379L) — replaced by the four files below.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunSubmitRoutes.scala` (NEW, 33L) — POST `/api/pipelines/:id/run[?dry=true]`.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunStatusRoutes.scala` (NEW, 48L) — GET `/api/pipelines/:id/runs/:runId` + GET `/api/pipelines/:id/steps/:stepId/preview`.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunHistoryRoutes.scala` (NEW, 23L) — GET `/api/pipelines/:id/run-history`.
- `backend/src/main/scala/com/helio/api/routes/PipelineRunStreamRoutes.scala` (NEW, 41L) — SSE GET `/api/pipelines/:id/run-events`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (MOD) — wires up the 4 new run route files via `PipelineRunService`; removes the single-file route registration.

## Backend — Spark

- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` (MOD, 237L, was 237L) — accepts `Seq[PipelineStep]` instead of `Seq[PipelineStepRow]`; `applyStep` becomes sealed-trait dispatch; Filter handler synthesizes SQL expression from typed conditions; Select / Limit / Sort / Aggregate fail-fast with descriptive errors (not previously implemented on Spark path).

## Backend — Flyway

- `backend/src/main/resources/db/migration/V31__add_aggregate_op.sql` (NEW) — extends `pipeline_steps.op` CHECK constraint to include `'aggregate'`. Closes the latent DB-constraint half of the AllowedOps drift.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` (NEW, 90L) — kind correctness + `PipelineStepKind.All` parity + sealed-trait pattern-match exhaustiveness.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` (NEW, 80L) — discriminated-union round-trip for every subtype + unknown-discriminator rejection + create / update request shape coverage.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` (NEW, 121L) — per-kind decode/encode round-trip + tolerance cases (filter / compute / aggregate partial configs) + failure modes.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` (MOD, 725L, was 702L) — fixtures rebuilt against typed steps via codec round-trip; unknown-op test moved to codec boundary; all existing per-op cases preserved verbatim.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` (MOD, ~245L, was 192L) — every test rewritten against the new `{ type, config: object }` wire shape; cross-type PATCH 400 test added; aggregate-acceptance regression test added.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` (MOD, 524L, was 552L) — composed against the 4 new route files via `PipelineRunService`; submitter / cross-step-row references replaced with typed-config calls.
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` (MOD) — select-step insert switched to typed `SelectConfig`; `step.op` → `step.type` assertion.
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` (MOD, ~336L) — every step builder replaced with typed-ADT helpers; rename uses `RenameConfig.renames` (not the old `mappings` array shape); filter uses typed conditions; unknown-op test rewritten to assert Select isn't yet supported on Spark.

## Frontend — types & service

- `frontend/src/types/models.ts` (MOD) — `PipelineStep` evolved to a discriminated union over `type` with 10 per-subtype interfaces + per-kind typed `*Config` interfaces. `AnalyzeStepResult` mirrors. `PipelineStepConfig` union + `PipelineStepKind` literal type exported for narrowing.
- `frontend/src/services/pipelineService.ts` (MOD) — `createPipelineStep` signature `(pipelineId, type: PipelineStepKind, config: PipelineStepConfig)`; `updatePipelineStep` signature `(stepId, config: PipelineStepConfig)`.

## Frontend — components

- `frontend/src/components/PipelineDetailPage.tsx` (MOD) — `Step.config` is now `PipelineStepConfig`; 8 stringly-typed parse helpers replaced with typed narrowing helpers; per-handler `JSON.stringify` calls gone; `defaultConfigFor(kind)` centralizes seed-config generation; `persist()` helper consolidates the PATCH + parent-notify flow; `pipelineStepToStep` narrows off `ps.type`.
- `frontend/src/components/FilterConfig.tsx` (MOD) — `onChange` signature changed to `(newConfig: FilterConfigValue)`; `JSON.stringify` removed.
- `frontend/src/components/ComputeFieldConfig.tsx` (MOD) — same pattern.
- `frontend/src/components/AggregateConfig.tsx` (MOD) — same pattern.
- `frontend/src/components/LimitConfig.tsx` (MOD) — same pattern.
- `frontend/src/components/SortConfig.tsx` (MOD) — same pattern.

## Frontend — tests

- `frontend/src/components/FilterConfig.test.tsx` (MOD) — `JSON.parse(mock.calls[0][0] as string)` → direct typed-object assertion.
- `frontend/src/components/ComputeFieldConfig.test.tsx` (MOD) — same pattern.
- `frontend/src/components/AggregateConfig.test.tsx` (MOD) — same pattern.
- `frontend/src/components/LimitConfig.test.tsx` (MOD) — typed-object assertion against `{ count: 25 }`.
- `frontend/src/components/SortConfig.test.tsx` (MOD) — typed-object assertion against `{ sortBy: SortKey[] }`.
- `frontend/src/components/PipelineDetailPage.test.tsx` (MOD) — fixtures migrated from stringified `config` to typed objects; `op: "X"` → `type: "X"`; `expect.stringContaining(...)` assertions replaced with `expect.objectContaining` / direct property checks.
- `frontend/src/features/pipelines/pipelinesSlice.test.ts` (MOD) — `sampleStep` and analyze fixture migrated to typed config + `type` discriminator.

## OpenSpec specs

- `openspec/specs/pipeline-steps-persistence/spec.md` (MOD) — wire shape requirements rewritten for the discriminated-union; CHECK constraint scenario updated to include `'aggregate'`; cross-type PATCH lock scenario added; typed-config scenarios added.
- `openspec/specs/pipeline-analyze-api/spec.md` (MOD) — top-level wire-shape sentence updated to call out the typed `config` per discriminator (per-scenario examples already used object literals).

## OpenSpec change folder (this PR's artifacts)

- `openspec/changes/2026-05-15-backend-pipeline-step-adt/` (NEW) — ticket / proposal / design / tasks / executor-report-1 / files-modified.

## Cycle 2 deltas

Cycle 2 addresses the evaluator's read-path tolerance blocker plus two of the
non-blocking suggestions (FQN cleanup in `PipelineRunService` + `submit`
nesting refactor). The DemoData seed-hygiene suggestion is not actionable —
`ProfitAgg` is not seeded by `DemoData.scala` (the evaluator's row was
created interactively in their local dev DB and persisted across restarts).

### Modified

- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` (170 → 265L, +95L) — added 7 per-kind tolerance helpers (`decodeRename` / `decodeJoin` / `decodeGroupBy` / `decodeCast` / `decodeSelect` / `decodeLimit` / `decodeSort`) matching the pattern of the 3 existing helpers; shared `asObject(raw)` extractor used by all 10 decoders; updated file-header docstring to describe the read-path tolerance contract. Soft over by 15L (acceptable per cycle-1 precedent).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (306 → 323L, +17L) — added `import scala.util.{Failure, Success}` (FQN cleanup at cycle-1 lines 96/112); added `Pipeline` / `DataSource` / `PipelineStep` to the domain import group; extracted the inner `submit` body (pre-execution + `runFuture.transformWith`) into a private `executeRun(pipeline, dataSource, steps, isDry)` helper. `submit` is now a flat delegation. Behaviour-preserving.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` (134 → 187L, +53L) — added 7 per-kind `decode(kind, "{}")` tolerance cases plus 1 parametric "every kind tolerates decode({})" case.

### New

- `backend/src/test/scala/com/helio/infrastructure/PipelineStepRepositorySpec.scala` (NEW, 113L) — embedded-Postgres regression coverage: reproduces the cycle-1 blocker by inserting a raw `pipeline_steps` row with `op='join'` / `config='{}'` and asserting `listByPipeline` returns a `JoinStep` with `JoinConfig("", "", "inner")` rather than throwing. Plus an "every kind tolerates raw config='{}'" round-trip and a full typed-config round-trip via `insert` + `listByPipeline`.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/executor-report-2.md` (NEW) — cycle 2 report.

### Test count

- `sbt test`: **577 / 577 PASS** (566 cycle-1 + 8 new codec + 3 new repo = 577)
- `npm test`: **664 / 664 PASS** (unchanged; cycle 2 is backend-only)

## Cycle 3 deltas

Cycle 3 folds in the polymorphic-method-per-step-file refactor requested
by the user after PR #151 was approved at the end of cycle 2. The wire
shape, DB columns, frontend, and cross-type-PATCH semantics are
unchanged; the change is purely structural — collapsing "data ADT +
central handlers + central codec" into self-contained per-kind modules
under `domain/steps/`.

### New

- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` (NEW, 150L) — `trait PipelineStep` with polymorphic `evaluate(rows, ctx)` method; `PipelineExecutionContext` bundle (dataSourceRepo + loadSource closure); `PipelineStep.Companion` contract + `PipelineStep.Registry` Map. `PipelineStepKind` re-exports the kind constants from each step file and derives `All` from `Registry.keySet` (no more hard-coded enumeration).
- `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala` (NEW, 77L) — cross-cutting row<->JsValue helpers extracted from the deleted `PipelineStepHandlers` object: `anyToJsValue`, `jsValueToAny`, `toDouble`, `rowToJsMap`, `parseStaticRows`. Consumed by step modules + `PipelineRunService`.
- `backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala` (NEW, 30L) — shared `asObject(raw)` + `stringOr(obj, key, default)` helpers used by per-step decoders.
- `backend/src/main/scala/com/helio/domain/steps/RenameStep.scala` (NEW, 70L) — `RenameConfig` + tolerant decode + `RenameStep` with `evaluate` + companion registry entry.
- `backend/src/main/scala/com/helio/domain/steps/FilterStep.scala` (NEW, 121L) — `FilterCondition` + `FilterConfig` + tolerant decode + `FilterStep` with `evaluate` (filter combinator + operator evaluation) + companion.
- `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala` (NEW, 97L) — `JoinConfig` + tolerant decode + `JoinStep` with `evaluate` (async; consumes `ctx.dataSourceRepo` + `ctx.loadSource`) + companion.
- `backend/src/main/scala/com/helio/domain/steps/ComputeStep.scala` (NEW, 79L) — `ComputeConfig` + tolerant decode + `ComputeStep` with `evaluate` (uses `ExpressionEvaluator`) + companion.
- `backend/src/main/scala/com/helio/domain/steps/GroupByStep.scala` (NEW, 84L) — `GroupByConfig` + tolerant decode + `GroupByStep` with `evaluate` (single-aggregation group-by) + companion.
- `backend/src/main/scala/com/helio/domain/steps/CastStep.scala` (NEW, 84L) — `CastConfig` + tolerant decode + `CastStep` with `evaluate` (per-target-type coercion) + companion.
- `backend/src/main/scala/com/helio/domain/steps/SelectStep.scala` (NEW, 60L) — `SelectConfig` + tolerant decode + `SelectStep` with `evaluate` + companion.
- `backend/src/main/scala/com/helio/domain/steps/LimitStep.scala` (NEW, 61L) — `LimitConfig` + tolerant decode + `LimitStep` with `evaluate` + companion.
- `backend/src/main/scala/com/helio/domain/steps/SortStep.scala` (NEW, 96L) — `SortKey` + `SortConfig` + tolerant decode + `SortStep` with `evaluate` (multi-key stable sort; numeric coercion fallback) + companion.
- `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala` (NEW, 113L) — `AggregateField` + `Aggregation` + `AggregateConfig` + tolerant decode + `AggregateStep` with `evaluate` (multi-aggregation group-by) + companion.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/executor-report-3.md` (NEW) — this cycle's report.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/evaluation-2.md` (already on disk pre-cycle-3; not new this cycle).

### Modified

- `backend/src/main/scala/com/helio/domain/package.scala` (MOD, 4 → 61L) — re-exports every step subtype + typed config from `com.helio.domain.steps` into `com.helio.domain`. The wildcard `import com.helio.domain._` surface that services / repositories / tests rely on resolves through these aliases without any caller changes.
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` (MOD, 145 → 124L) — `applyStep` removed; engine now folds over steps invoking `step.evaluate(rows, ctx)`. New private `makeContext(dataSourceRepo)` builds the `PipelineExecutionContext`. Static / CSV row-source loading unchanged.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` (MOD, 264 → 115L) — reduced to a thin facade over `PipelineStep.Registry`. The four public methods (`decode` / `encode` / `encodeConfig` / `encodeJsObject`) preserve their cycle-2 signatures, delegating to per-step companions. Per-kind tolerance defaults now live in each step file's `*Config.decode(raw)`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` (MOD, 176 → 178L) — per-config formats now sourced from each step module's companion (`RenameConfig.format`, etc.) instead of being re-declared in the protocol trait. Wire shape unchanged.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (MOD, 323 → 323L) — three call sites switched from `PipelineStepHandlers.anyToJsValue` to `PipelineRowJson.anyToJsValue`. Logic + signatures + line count unchanged.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/proposal.md` (APPENDED) — cycle 3 scope section + file-size target table.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/design.md` (APPENDED) — cycle 3 design section: why the structural shift, polymorphic evaluate trait, registry-derived kind set, sealed-trait trade-off, codec facade decision, what stays the same, deferred items.
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/tasks.md` (APPENDED) — section 16 with cycle 3 sub-tasks (all checked).
- `openspec/changes/2026-05-15-backend-pipeline-step-adt/files-modified.md` (APPENDED) — this section.

### Deleted

- `backend/src/main/scala/com/helio/domain/Pipeline.scala` (DELETED, was 189L) — contents superseded by `PipelineStep.scala` + `domain/steps/<Kind>Step.scala`.
- `backend/src/main/scala/com/helio/domain/PipelineStepHandlers.scala` (DELETED, was 311L) — per-kind `applyX` functions distributed into the corresponding `domain/steps/<Kind>Step.scala` `apply` methods; shared row helpers moved to `PipelineRowJson.scala`.

### Test count

- `sbt test`: **577 / 577 PASS** (unchanged — no new tests this cycle; the existing tests exercise every per-step path via the registry-derived codec)
- `npm test`: **664 / 664 PASS** (unchanged — frontend untouched)

### Scala-quality soft-warnings

- Cycle 2: 21 soft warnings (20 cycle-1 pre-existing + 1 new from codec at 264L)
- Cycle 3: 19 soft warnings (cycle-2 codec 264L + cycle-1 handlers 311L both retired; no new warnings introduced)
