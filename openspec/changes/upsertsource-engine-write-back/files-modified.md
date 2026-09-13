# Files modified — HEL-1100 upsertsource engine write-back

Base SHA (LIVE-resolved via `scripts/concertino/resolve-review-base.sh`): `0cc7aef797be23b6358266daf9a96f3b96f9b7ff`

## Backend — new files

- `backend/src/main/scala/com/helio/domain/steps/UpsertSourceStep.scala` — the registered
  `UpsertSourceStep`/`Companion`: `evaluate` defers the write into `ctx.writeBackSink` (D2);
  `requiredConfigProblems` flags an unset target (D1); reuses HEL-1099's `UpsertSourceConfig`.
- `backend/src/main/scala/com/helio/domain/model/WriteBackSink.scala` — `PendingWrite` +
  `WriteBackSink`, mirroring `AssertionSink`'s output-parameter convention (D2).
- `backend/src/test/scala/com/helio/domain/steps/UpsertSourceStepSpec.scala` — unit coverage:
  registry membership, config round-trip, `requiredConfigProblems`, `evaluate` records a
  `PendingWrite` and returns rows unchanged.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceUpsertSourceSpec.scala`
  — real-run (EmbeddedPostgres) coverage: append preserves existing rows (3.2), dry run leaves
  the target untouched (3.5), an undeclared-column validation failure fails the run and commits
  nothing (3.6), new-source create-then-append-on-second-run and zero-rows-is-a-no-op (3.8),
  zero-row replace clears the target (3.8a), full replace.
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositoryApplyWriteBacksSpec.scala`
  — atomicity coverage against a real Postgres: concurrent-reader-never-sees-empty/partial-set
  during a replace (3.3, a real separate-connection polling loop, not inferred); a later write's
  failure in the same batch commits NOTHING from an earlier, individually-valid write (3.4).
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositoryApplyWriteBacksRlsSpec.scala`
  — RLS coverage under a real NOBYPASSRLS `helio_app_test` role (C1): owner write lands; a
  foreign-owned target is never written even though the row genuinely exists (RLS backstop); a
  direct `appendRowsAction` call proves the FORCEd RLS policy alone (cycle 3, non-blocking note).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceUpsertSourceRlsSpec.scala`
  (cycle 2) — RLS coverage for a real scheduler-fired run and a real editor-grantee-triggered run.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeUpsertSourceSpec.scala`
  (cycle 3, CR1) — `PipelineService.analyze`/`analyzeProposal` with a real upsertsource step;
  closes the live 500 the skeptic found.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewProjectionStepsUpsertSourceSpec.scala`
  (cycle 3, CR2) — `PipelineStepProjectionSupport.withPosition`/`withDecodedConfig` with a real
  `UpsertSourceStep`; closes the `MatchError`/spurious-`Left` the skeptic found.

## Backend — modified files

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — registers
  `UpsertSourceStep.Kind -> UpsertSourceStep.companion` in `PipelineStep.Registry`; adds
  `PipelineStepKind.UpsertSource`; adds `writeBackSink` field to `PipelineExecutionContext`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exports `UpsertSourceStep`,
  `UpsertTarget`, `UpsertSourceConfig` into `com.helio.domain` (mirrors every other step kind).
- `backend/src/main/scala/com/helio/domain/engine/PipelineExecutionBackend.scala` — adds
  `supportsWriteBack: Boolean = false` (D3) and a defaulted `writeBackSink` param to `execute`.
- `backend/src/main/scala/com/helio/domain/engine/InProcessExecutionBackend.scala` — overrides
  `supportsWriteBack = true`; threads `writeBackSink` into `engine.executeTree`.
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — threads
  `writeBackSink` through `executeTree`/`makeContext` into every step's `PipelineExecutionContext`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` — adds
  `"upsertsource"` to the pass-through `inferOutputSchema` arm (D8).
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — accepts (and ignores) the
  new `writeBackSink` param, per the trait's "leave untouched" convention for sinks it has no
  concept of; `supportsWriteBack` stays `false` (inherited default).
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
  — task 1.3: extracts `appendRowsAction`/`replaceRowsAction`/`insertDatasetSourceAction`
  (`private[persistence]` DBIO builders) out of `appendRows`/`replaceRows`/`insertDatasetSource`,
  which now just wrap them in `ctx.withUserContext`, behavior-unchanged. Task 1.4/1.4a: adds
  `applyWriteBacks(owner, writes, stepRepo, maxRows)` (one transaction, fail-fast on any `Left`,
  D4/D6), `writeExistingDatasetAction`/`newDatasetSourceAction`/`ownedDatasetNameAction`/
  `mapWriteBackRows` (D5/D6/D7 helpers).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
  — task 1.4a: adds `rewriteUpsertTargetAction` (D7's new-source compare-and-set: step-row lock,
  compare persisted vs. evaluated config, create+rewrite / reuse-existing / fail-on-mid-run-edit).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — task 1.5/1.6:
  constructs a `WriteBackSink` per run, threads it into `backend.execute`; `onRunSuccess` now
  applies pending writes (as the pipeline OWNER, D5) after the blocked-check and before
  `onUnblockedRunSuccess`; a write-back failure takes the same terminal-failure bookkeeping as an
  engine failure (`onWriteBackFailure`). `runPipeline` rejects a run containing an enabled
  `upsertsource` step when `!backend.supportsWriteBack` (D3).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — task 1.7: adds
  `upsertOwnershipCheckF` (D1, resolves against the pipeline OWNER, never the caller) called from
  `create`, `addStep` (both owner and grantee branches), and `updateStep`; every
  `actingUserId` at a cycle-check call site inside `persistNewStep`/`updateStep`/`duplicateStep`
  is now `pipelineOwnerId.value`/`pipeline.ownerId.value`, not the caller's id (D1).
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — promotes the
  private `staticMaxRows` value to a public `DataSourceService.DatasetMaxRows = 500` companion
  constant (D6), unchanged value.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — adds
  `UpsertSourceStepResponse`, its formatter, and the union dispatch entries (write/read/fromDomain).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala` (cycle
  3, CR1) — adds `UpsertSourceAnalyzeStepResponse`, its formatter, and the union dispatch entries.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` (cycle 3, CR1) — adds
  the missing `case Success(cfg: UpsertSourceConfig) =>` arm to `toAnalyzeStepResponse`.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjectionSteps.scala`
  (cycle 3, CR2) — adds the missing `UpsertSourceStep`/`UpsertSourceConfig` arms to
  `withPosition`/`withDecodedConfig`.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — task 2.1: adds
  `unsupportedOpType`/`isUnsupportedOpType`; `pipelineStepToStep`'s unknown-kind fallback is now
  `unsupportedOpType(ps.type)`, not `OP_TYPES[0]` (D9).
- `frontend/src/features/pipelines/ui/StepOpEditor.tsx` — task 2.2: renders a read-only notice
  for `isUnsupportedOpType(step.opType)` before any of the per-kind editor branches.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — task 2.2: `persist` returns
  early (no `updatePipelineStep` call) when `isUnsupportedOpType(step.opType)`.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCreateTransactionalSpec.scala` —
  task 3.1: flips only the `upsertsource` arm of the pinned "reject until wired" test (the other
  three ops stay pinned, C3); adds a real accept-case for a `NewSource`-targeted `upsertsource`.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCycleDetectionServiceSpec.scala`
  — task 3.9 (partial, see Known gaps below): adds 3 new API-level tests (`create`/`addStep`,
  real HTTP-shaped requests, not the repository test-seam) now that `upsertsource` is registered.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — updates
  `SpyExecutionBackend.execute`'s override to accept (and forward) the new `writeBackSink` param
  (an arity mismatch there made it a second overload rather than an override).
- `backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala`,
  `backend/src/test/scala/com/helio/domain/steps/PipelineStepRequiredConfigSpec.scala`,
  `backend/src/test/scala/com/helio/domain/engine/PipelineAnalyzeServiceSpec.scala` — registry-
  parity/coverage guards updated for the 24th registered kind (real, pre-existing mechanical
  guards this ticket's own registration correctly tripped; not weakened, just extended).
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts`,
  `frontend/src/features/pipelines/hooks/useStepCardState.test.ts`,
  `frontend/src/features/pipelines/ui/StepCard.test.tsx` — new tests for the D9 fallback/notice/
  no-PATCH behavior (task 2.1/2.2).

## Task 1.9 — hardcoded op-enumeration audit (D10)

Grepped `backend/src/main`, `frontend/src`, and `helio-mcp/src` for hardcoded step-op lists
(`allowedOps`, prompt/tool-description copy, MCP schemas):

- `helio-mcp/src/tools/write.ts:375` (`add_pipeline_step`'s tool description, seeded per the
  Planning note) — **deliberately excluded**. HEL-1102 owns wiring `upsertsource` into the MCP
  surface; the description string still lists only the pre-existing 17 transform ops. No other
  `z.enum([...])` in `helio-mcp/src` enumerates step ops (the rest are source-kind/panel-kind/
  chart-type enums, unrelated).
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala:454` (seeded per
  the Planning note) — **registered**: `inferOutputSchema`'s pass-through arm now includes
  `"upsertsource"` (task 1.8, see above).
- `frontend/src/features/pipelines/state/stepNarrowing.ts`'s `OP_TYPES` (the picker dropdown) —
  **deliberately excluded**, per design.md D9: `upsertsource` has no step-card editor yet
  (HEL-1102's job), so it is never offered in the "add step" picker; a persisted `upsertsource`
  step still round-trips via `pipelineStepToStep`'s `unsupportedOpType` fallback.
- Every other backend allow-list (`PipelineStepKind.All`, `PipelineStep.Registry`,
  `PipelineStepConfigCodec.encodeConfig`/`decode`) is registry-derived, not a second hand-copied
  list — `upsertsource`'s presence in `PipelineStep.Registry` is the single source of truth these
  already read from; no separate edit was needed or possible for them to drift.
- No other `allowedOps`-shaped literal naming step kinds was found in `backend/src/main`,
  `frontend/src`, or `helio-mcp/src`.

## Root cause / probe / evidence records (systematic-debugging.md)

Not a bug-fix ticket in the strict sense (a new feature), but three real defects surfaced and
were fixed during implementation:

1. **Registry-parity/coverage guards regressed by registering a 24th kind.**
   - Root cause: `PipelineStepSpec`, `PipelineStepRequiredConfigSpec`, and
     `PipelineAnalyzeServiceSpec` each hardcode the CURRENT count/set of registered step kinds as
     a mechanical drift guard; registering `upsertsource` correctly tripped all three.
   - Probe: `sbt test` (full suite) — 4 failing tests, each naming the exact hardcoded
     count/set/probe-map that needed the 24th entry.
   - Fix: added `upsertsource`'s entry/count/probe to each of the three specs (see "Backend —
     modified files" above). Re-ran `sbt test` — 4330/4330 green.

2. **`check:scala-quality` inline-FQN violations from newly-added cross-package parameter types.**
   - Root cause: several new/modified signatures inlined `com.helio.domain.model.X`/
     `spray.json.JsString` instead of a top-of-file import (`SparkJobSubmitter.execute`'s new
     `writeBackSink` param, `PipelineRunService`'s new `pipelineOwnerId: UserId` params,
     `PipelineStepRepository.rewriteUpsertTargetAction`'s `dsRepo` param, two new test files).
   - Probe: `npm run check:scala-quality` — named every offending file:line.
   - Fix: added the missing top-of-file imports; re-ran the check — clean.

3. **Scala effect-type mismatch in `applyWriteBacks`'s `foldLeft` accumulator.**
   - Root cause: `DBIO.successful(Right(()))`'s inferred effect-type parameter (`Effect`) didn't
     match `applyOne`'s inferred `Effect.All` (from the raw-SQL lock inside
     `rewriteUpsertTargetAction`), which Slick's invariant `DBIOAction` effect parameter rejects
     without an explicit type ascription.
   - Probe: `sbt compile` — `type mismatch; found DBIOAction[..., Effect.All]; required
     DBIOAction[..., Effect]` at the `foldLeft` call site.
   - Fix: hoisted the accumulator into a `val start: DBIO[Either[String, Unit]]` with an explicit
     type ascription before the fold. Re-ran `sbt compile` — clean.

## Standing Constraints (tasks.md) — evidence

- **C1** (every RLS/ownership assertion runs under a NOBYPASSRLS role): satisfied by
  `DataSourceRepositoryApplyWriteBacksRlsSpec` and (cycle 2)
  `PipelineRunServiceUpsertSourceRlsSpec`, both of which build the `helio_app_test`/
  `helio_privileged` two-role harness (the `RlsSharingAwareTablesSpec` pattern) rather than the
  superuser-pool convention most sibling integration specs use.
- **C2** (3.3-3.5 proven failable by mutation, red-then-green recorded): two live mutations this
  session, both against real specs, both reverted after capturing the red output —
  - **3.4** (`DataSourceRepositoryApplyWriteBacksSpec`): replaced
    `ctx.withUserContext(owner.id.value)(failFast.transactionally)` with a variant that discards
    `chained`'s `Left` and always succeeds (`chained.map(_ => ()).transactionally`), i.e. removed
    the fail-fast escalation entirely. **Red**: `should fail the WHOLE batch atomically...`
    failed — `Right(()) was not an instance of scala.util.Left`. **Green**: reverted; 4/4 pass.
  - **3.5** (cycle 2, CR4 — `PipelineRunServiceUpsertSourceSpec`): in `PipelineRunService.scala`,
    changed the dry-run branch guard from `if (isDry) onDryRunSuccess(...)` to `if (false)
    onDryRunSuccess(...)`, i.e. routed EVERY run (including dry runs) through the write-applying
    `onRunSuccess` branch. **Red**: `should leave the target dataset unchanged (3.5)` failed —
    `Vector(["alice"], ["carol"]) had size 2 instead of expected size 1` (the dry run's write
    landed). **Green**: reverted to `if (isDry) ...`; 7/7 pass (8/8 after 3.8a's addition).
  - 3.3 (the concurrent-reader test) is itself evidence against a genuine engine bug class (MVCC
    dependence), not something a single-line mutation demonstrates failing — its correctness
    argument is the real-Postgres separate-connection polling loop finding zero, not a mutation.
- **C3** (only `upsertsource` registered; the other three rejected): verified by
  `PipelineCreateTransactionalSpec`'s remaining `convertformat`/`analyzewithai`/`generatetext`
  pinned-rejection cases (still passing) and `PipelineStep.Registry.keySet` (24 entries, checked
  in `PipelineStepRequiredConfigSpec`/`UpsertSourceStepSpec`).

## Cycle 2 (evaluation-1.md change requests) — new files/changes

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceUpsertSourceRlsSpec.scala`
  (new) — CR2: builds the two-role (`helio_app_test`/`helio_privileged`) RLS harness around the
  FULL `PipelineRunService`/`PipelineSchedulerService` graph (not just `DataSourceRepository`).
  Two tests, each driving a REAL run through the real entry point: (1) seeds a due
  `pipeline_schedules` row and calls `PipelineSchedulerService.tick()` — confirms the target
  dataset's row is visible under `ctx.withUserContext(owner)` (not just the privileged pool).
  (2) grants an unrelated user `editor` on the pipeline and calls
  `PipelineRunService.submit(pid, isDry = false, granteeUser)` — confirms the write is visible
  under the OWNER's RLS context and explicitly NOT visible under the GRANTEE's own RLS context
  (`dataset_rows` FORCE RLS is owner-only, V106 — a pipeline-sharing grant confers no visibility
  onto the target dataset).
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositoryApplyWriteBacksSpec.scala`
  (extended) — CR3: two new tests, both against a real Postgres instance. (1) "serialize two runs
  racing to create the SAME new-source dataset" — two `applyWriteBacks` calls are STARTED (not
  awaited) before either is awaited, so they genuinely overlap in wall-clock time; asserts exactly
  one `data_sources` row named `race-target` exists, both writes' rows landed in it, and the step
  was rewritten to `ExistingSource(newId)` exactly once. (2) "fail the run... when the step's
  config changed mid-run" — updates the persisted step's config to a DIFFERENT new-source name
  than the (stale) evaluated config the write carries; asserts the run fails naming "configuration
  changed during the run", nothing is committed, and the user's edit is kept.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` (mutation-only,
  reverted) — CR4's live mutation probe, see C2 above; no net diff versus cycle 1.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceUpsertSourceSpec.scala`
  (extended) — 3.8a: a new describe block chaining TWO trunk `upsertsource` steps onto the SAME
  target (step 1 appends the source's row, step 2 replaces with the same input) — the two
  candidate orderings produce OBSERVABLY DIFFERENT final row counts (1 vs 2), so asserting exactly
  1 genuinely proves walk order, not merely that both writes landed.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCycleDetectionServiceSpec.scala`
  (extended) — CR1: 8 new API-level (real `PipelineService`/`PipelineProposalService` calls, never
  the repository test-seam) tests, now that `upsertsource` is registered:
  - `addStep()`: a direct self-cycle (new).
  - `updateStep()`: a direct self-cycle AND a transitive (via another pipeline) cycle.
  - `duplicateStep()`: a direct self-cycle AND a transitive cycle. Since `duplicateStep` clones
    an EXISTING step's config verbatim, the original row is seeded via the repository test-seam
    (raw SQL) to simulate data that reached the table before the closing edge existed —
    `duplicateStep`'s OWN fresh cycle check (run again at duplicate time, never skipped) is what
    is actually being proven, not a vacuous re-check of an edge already known-good.
  - `PipelineProposalService.apply()`: a direct self-cycle AND a transitive cycle, via a real
    `PipelineProposal` carrying an `upsertsource` step in its `steps` list.
  - All 8 reject correctly — **no defect found** in any of these paths; the cycle guard's
    single-call-site wiring in `PipelineStepRepository` (shared by every one of these entry
    points) holds up under real API-level exercise.
  - **"import" is NOT covered — verified inapplicable, not skipped.** Grepped
    `backend/src/main/scala/com/helio/api/ApiRoutes.scala` and every file under
    `backend/src/main/scala/com/helio/api/routes/pipelines/` and
    `backend/src/main/scala/com/helio/services/pipelines/` for any pipeline-level import
    feature: **none exists**. The only "import" in this codebase is dashboard import/export
    (`POST /api/dashboards/import`), which creates panels bound to EXISTING Outputs and never
    touches `pipeline_steps` or the cycle guard at all — it shares no code path with pipeline
    write-edge detection. The ticket AC's "every ... create/update/import/duplicate/proposal-apply
    path it covers" and design.md D1's list of call sites (`create`, `addStep`, `updateStep`,
    `duplicate`) never actually names a pipeline "import" call site either — "import" appears to
    be inherited generically from HEL-1101's broader "every mutation path" framing rather than a
    real, distinct write path in this codebase. This is a documentation/AC-wording gap in the
    inherited ticket text, not a cycle-guard coverage defect.

## Cycle 3 (skeptic-final-1.md change requests) — real defects found and fixed

The skeptic found two real crashes by running the app live (`start-servers.sh`) that no test in
cycles 1-2 caught, because no test drove `PipelineService.analyze`/`analyzeProposal` or the
patch-set preview path with an `upsertsource` step. Both are the SAME defect class: a per-kind
exhaustive `match` (no wildcard arm, since `PipelineStep` is deliberately not `sealed`) that was
never given an `upsertsource` arm when the kind was registered in cycle 1.

### CR1 — `GET /pipelines/:id/analyze` / `POST /pipelines/analyze-proposal` 500 on any upsertsource pipeline

- **Root cause**: `PipelineService.toAnalyzeStepResponse` (`PipelineService.scala:1638-1666`)
  matches on every `*Config` type to build the discriminated-union analyze response; no
  `UpsertSourceConfig` arm existed, so `PipelineAnalyzeService`'s own already-correct pass-through
  inference (cycle 1) had nowhere to land on the wire — every call threw
  `IllegalStateException: codec returned unexpected config type ... for op 'upsertsource'`.
- **Probe (live, before fix)**: started the app via `scripts/concertino/start-servers.sh`,
  created a real pipeline with an `upsertsource` step via the real API, and called
  `GET /api/pipelines/:id/analyze` — **500**, with exactly the exception above in
  `.concertino-backend.log`. `POST /api/pipelines/analyze-proposal` with the same shape — **500**,
  same exception.
- **Fix**: added `UpsertSourceAnalyzeStepResponse` (`PipelineAnalyzeProtocol.scala`, config +
  input/output schema + validationError, same shape as every sibling), its JSON format and
  union-dispatch entries, and a `case Success(cfg: UpsertSourceConfig) =>` arm in
  `toAnalyzeStepResponse`. No `schemas/` JSON-Schema file enumerates analyze response subtypes by
  name (`npm run check:schemas` stayed clean before and after), so no separate schema-contract
  edit was needed.
- **New test**: `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeUpsertSourceSpec.scala`
  — calls `PipelineService.analyze`/`analyzeProposal` directly (service-level) with a real
  upsertsource step followed by a `select` step; asserts `Right`, `outputSchema == inputSchema`
  for the upsertsource step, and the downstream `select` step's `inputSchema` equals the
  upsertsource step's `inputSchema` (the spec's own "pass-through" scenario).
- **Probe (live, after fix)**: restarted the backend (killed the stale pre-fix JVM by its exact
  PID, since `sbt run` does not hot-reload), repeated the exact same live sequence — `GET
  /analyze` → **200** with the upsertsource step's `outputSchema == inputSchema`;
  `POST /analyze-proposal` → **200**, same shape. Probe pipeline/sources deleted afterward (204s).

### CR2 — patch-set preview `MatchError`/spurious `Left` on any upsertsource step

- **Root cause**: `PipelineStepProjectionSupport.withPosition`/`withDecodedConfig`
  (`PatchSetPreviewProjectionSteps.scala`) are the SAME defect class as CR1 — per-kind exhaustive
  matches over `PipelineStep`/`(PipelineStep, Any)` with no `upsertsource` arm and no wildcard.
  `withPosition` throws a real `scala.MatchError`; `withDecodedConfig` returns a spurious
  `Left("config decode produced a type mismatched with step kind 'upsertsource'")` even though the
  types match perfectly — both reachable from `PatchSetPreviewProjection.pipelineStepUpdateAfter`
  (:352), i.e. any patch-set preview touching a persisted upsertsource step.
- **Fix**: added `case s: UpsertSourceStep => s.copy(position = position)` and
  `case (s: UpsertSourceStep, c: UpsertSourceConfig) => Right(s.copy(config = c))` arms.
- **New test + mutation proof**:
  `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewProjectionStepsUpsertSourceSpec.scala`
  (unit, calls the `private[services]` object directly — same package). **Red** (mutation:
  commented out both new arms): `withPosition` threw the exact `scala.MatchError:
  UpsertSourceStep(...)` from the field report; `withDecodedConfig` returned the spurious `Left`.
  **Green**: reverted; 2/2 pass.
- **D10 audit redone for per-kind exhaustive matches (C4)** — grepped `backend/src/main` for
  `RenameStep` (present in every genuinely-exhaustive per-kind match, since it's always kind #1 in
  the canonical enumeration order; a second grep on `UnionStep`/`LookupStep` cross-checked for any
  match that might omit Rename) and classified every hit:

  | File | Match | Outcome |
  | --- | --- | --- |
  | `api/protocols/pipelines/PipelineStepConfigCodec.scala` (`encodeConfig`) | 24-arm exhaustive | Has `upsertsource` arm (cycle 1) |
  | `api/protocols/pipelines/PipelineStepProtocol.scala` (`fromDomain`, wire read/write) | 24-arm exhaustive | Has `upsertsource` arm (cycle 1) |
  | `domain/model/PipelineStep.scala` (`Registry`) | 24-arm exhaustive | Has `upsertsource` entry (cycle 1) |
  | `domain/package.scala` (re-exports) | N/A (aliases, not a match) | Re-exports `UpsertSourceStep`/`Config`/`Target` (cycle 1) |
  | `infrastructure/persistence/pipelines/PipelineStepRepository.scala` (`rowToDomain`) | 24-arm exhaustive | Has `upsertsource` arm (cycle 1) |
  | `services/patchsets/PatchSetPreviewProjectionSteps.scala` (`withPosition`, `withDecodedConfig`) | 22/23-arm exhaustive, NO wildcard | **Missing — fixed this cycle (CR2)** |
  | `api/protocols/pipelines/PipelineAnalyzeProtocol.scala` (analyze response union) | 24-arm exhaustive | Has `upsertsource` arm (cycle 3, CR1) |
  | `services/pipelines/PipelineService.scala` (`toAnalyzeStepResponse`) | 24-arm exhaustive | **Missing — fixed this cycle (CR1)** |
  | `spark/SparkJobSubmitter.scala` (`applyStep`) | 10-arm PARTIAL match (Rename/Filter/Compute/GroupBy/Cast/Join fully implemented; Select/Limit/Sort/Aggregate throw a named "not yet supported" `IllegalArgumentException`) | **Deliberately NOT given an arm.** This match was NEVER exhaustive over all 24 (pre-existing, unrelated to this ticket — 14 OTHER kinds, e.g. `SplitTextStep`/`PivotStep`/`AssertStep`, are equally absent and would equally `MatchError`). Adding `upsertsource` here would be inconsistent scope creep against a pre-existing gap this ticket does not own. Guarded at runtime regardless: `PipelineRunService.runPipeline` rejects any run containing an enabled `upsertsource` step when `!backend.supportsWriteBack` (D3), and `SparkJobSubmitter.supportsWriteBack` is the inherited `false` default — Spark can never reach `applyStep` with an upsertsource step in production. |
  | `domain/engine/InProcessPipelineEngine.scala` / `domain/engine/PipelineAnalyzeService.scala` (`laneDependencyOf`, lane-secondaryInput dispatch) | 3-arm match (`JoinStep`/`UnionStep`/`LookupStep` only) | N/A — deliberately scoped to the 3 kinds with a `secondaryInput` concept; `upsertsource` has none |
  | `domain/steps/*.scala`, `domain/steps/README.md` | Each kind's own file / doc | N/A |

  No other per-kind exhaustive match was found. `check:scala-quality`/`sbt compile` stayed clean
  throughout (a genuinely-missing wildcard-free arm is a *runtime* `MatchError`, not a compile
  error, since `PipelineStep` is deliberately not `sealed` — see `PipelineStep.scala`'s own doc —
  which is exactly why this class of defect is invisible to the compiler and needs this audit).

### CR3 — deferral scenarios: later-failing sibling step, and `previewStep`

- **New tests** (`PipelineRunServiceUpsertSourceSpec.scala`): (a) an upsertsource step followed by
  a `compute` step with a statically-unparseable expression (HEL-888's own repro shape) — asserts
  the run fails, the target is byte-identical, `last_run_status = failed`, and zero node snapshots.
  (b) `service.previewStep(pid, upsertStepId, user)` — asserts `Right` and the target byte-identical.
- **Mutation (a) — Failure branch**: temporarily awaited `dataSourceRepo.applyWriteBacks(...)`
  inside `executeRun`'s `Failure(ex)` branch before the rest of `failWork`. **Red**: target grew
  from `["alice"]` to `["alice", "carol"]`. **Green**: reverted; `git diff` empty.
  (Diff-verified clean revert.)
- **Mutation (b) — `previewAtNode`**: temporarily threaded a real `WriteBackSink` into the
  per-step preview's `backend.execute(...)` call and applied it via `dataSourceRepo
  .applyWriteBacks(...)` before returning the preview response. **Red**: same
  `["alice", "carol"]` growth. **Green**: reverted; `git diff` empty.
- **Non-blocking notes folded in**: 3.6's undeclared-column test now also asserts
  `last_run_status = failed` and zero node snapshots; the RLS foreign-target test gained a
  companion that calls `appendRowsAction` directly under `withUserContext(ownerA)` against a
  foreign id (no app-level ownerId filter in that method at all), proving the FORCEd RLS policy
  ALONE returns `None` (source-not-found) for a row that genuinely exists.

### CR4 — strengthen and mutation-prove the 3.3 concurrent-reader test

- **Strengthened assertion**: the reader loop now fetches the actual `name` values (not just a
  row count) each iteration, classifies every read as exactly the 400-row OLD set, exactly the
  300-row NEW set, or NEITHER (asserted to never happen), and separately asserts the number of
  reads that overlapped the write's own execution window is `> 0` (proving the loop genuinely
  raced the write rather than running entirely before/after it).
- **Mutation**: a nested `DBIO.from(ctx.withSystemContext(...))` split of the delete/insert into
  two independently-committed transactions caused a Slick connection-pool deadlock (30s timeout)
  rather than a clean assertion failure — reverted immediately (`git diff` confirmed clean) as
  unsafe. The mutation actually used instead: a temporary single-write bypass in
  `applyWriteBacks` itself (still production code, still Future-level, no nested-DBIO-in-DBIO)
  that runs the delete and the insert as two SEPARATE `ctx.withUserContext(owner)` calls on the
  same (app) pool. **Red**: `7 of 46 reads observed neither the old nor the new set` — a real,
  literal half-written/empty state was observed by the concurrent reader. **Green**: reverted;
  `git diff` confirmed clean; re-ran — 4/4 pass.

## Known gaps (documented, not silently dropped)

All four skeptic-final-1.md CRs and both non-blocking notes are now closed with real, fresh
evidence (see Cycle 3 above). No known gaps remain against tasks.md's literal wording, other than
the two already-documented, deliberate exclusions: pipeline "import" (verified nonexistent, not a
cycle-guard defect) and `SparkJobSubmitter.applyStep`'s pre-existing, out-of-scope partial match
(guarded at runtime by `supportsWriteBack`, never reachable with an upsertsource step in
production).
