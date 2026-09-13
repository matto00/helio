## Context

See proposal.md. Grounding: `PipelineStep.Registry` (domain/model/PipelineStep.scala) is the single allow-list;
`InProcessPipelineEngine.executeTree` evaluates steps mid-walk with no transaction; `PipelineRunService.executeRun`
branches Failure/Success, and `onRunSuccess` handles assertion blocking then node snapshots. Dataset row writes live
in `DataSourceRepository.appendRows`/`replaceRows` (lock `FOR UPDATE`, `DatasetRowValidator` inside the lock,
`ctx.withUserContext`). `dataset_rows` RLS (V106) is owner-only and FORCEd. `PipelineSchedulerService.fire` submits as
an `AuthenticatedUser(pipeline.ownerId, System)`. Cycle guard: `PipelineStepRepository.cycleCheckForUpsertAction`.
Driver-relayed answers to the Planning escalation (2026-09-13) are recorded as Decisions 3, 5, 6, 7.

## Goals / Non-Goals

**Goals:** a correct, transactional write-back step reusing the row-write API code. **Non-Goals:** see proposal.

## Decisions

**D1 — Register only `upsertsource`; pre-flight as the pipeline OWNER.** New `domain/steps/UpsertSourceStep.scala` with a
`Companion` delegating `decodeConfig`/`validateRawConfig` to `UpsertSourceConfig`, and `requiredConfigProblems`
flagging an unset target (`ExistingSource("")` or blank `NewSource` name). Flip only the `upsertsource` arm of
`PipelineCreateTransactionalSpec`'s pinned rejection. `PipelineService` create/addStep/updateStep pre-flight calls
`UpsertSourceConfig.validateTargetOwnership(target, AuthenticatedUser(pipeline.ownerId), ...)`: resolved against the
pipeline OWNER, not the caller, because D5 writes as the owner. A grantee therefore cannot target the grantee's own
dataset (rejected at write time, "data source not found"), but can target the owner's. The HEL-1101 cycle check's
`actingUserId` is likewise `pipeline.ownerId` at every `PipelineService` call site (create :573, addStep
:1850-1952, updateStep :2057, duplicate :2205): the graph the write participates in is the owner's. This is a no-op
for every other kind (`cycleCheckForUpsertAction` short-circuits on `kind != "upsertsource"`). Import and
proposal-apply reach these same repository actions; the executor confirms each in files-modified.md.

**D2 — Deferred write via a sink, not a write inside `evaluate`.** `evaluate` returns rows unchanged and appends a
`PendingWrite(stepId, config, rows)` to a new `WriteBackSink` on `PipelineExecutionContext` (default: fresh, unread
sink, mirroring `AssertionSink`). Rationale: the walk is non-transactional and shared by preview/dry run (Decision 5
of HEL-905), so an in-`evaluate` write would commit before a sibling lane fails and would fire on previews.
Alternative (write in `evaluate`, compensate on failure) rejected: no compensation for replace, and readers see
intermediate state.

**D3 — Apply point in `PipelineRunService`.** In `executeRun`'s Success branch, for non-dry runs: compute blocking
assertion failures first; if blocked, existing `onBlockedRun` (no write). Otherwise apply all pending writes BEFORE
`onUnblockedRunSuccess` (which publishes "succeeded" as its first statement, :1123). If applying fails, take the same
terminal-failure bookkeeping as the Failure branch (run `failed`, `errorLog` = `Step '<id>' (upsertsource): <reason>`,
no snapshot writes). Writes are ordered by the walk's evaluation order. Spark: `PipelineExecutionBackend` gains
`def supportsWriteBack: Boolean = false` (`InProcessExecutionBackend` overrides `true`). `PipelineRunService.runPipeline`
(:284), before `executeRun`/`backend.execute`, rejects a run whose enabled steps include `upsertsource` when
`!backend.supportsWriteBack` with `UnprocessableEntity("The 'upsertsource' step requires the in-process engine")`,
at submit time (step creation is unaffected: the backend is a deployment choice, not a pipeline property).

**D4 — One transaction through the row-write API's own actions.** Refactor `DataSourceRepository.appendRows`/
`replaceRows`/`insertDatasetSource` into `private[persistence]`-visible `DBIO` builders (`appendRowsAction`, ...)
that the existing `Future` methods wrap unchanged (routes keep identical behavior). New
`DataSourceRepository.applyWriteBacks(owner, writes)` composes them in one `ctx.withUserContext(owner)` transaction;
any `Left` becomes a `DBIO.failed` so the whole transaction rolls back. Replace keeps its delete-then-insert inside
the transaction: Postgres MVCC means a READ COMMITTED reader sees the old committed set until commit, which a real
concurrent-read test must prove (not asserted from reading). Alternative (a new staging table + rename) rejected:
needs a migration; the driver forbade one without escalation and MVCC already gives the guarantee.

**D5 — Owner identity, user-context pool.** The write runs as `AuthenticatedUser(pipeline.ownerId, source =
triggering user's source, tokenId = triggering tokenId)` on the normal pool, so `app.current_user_id` = owner and
FORCEd RLS applies. Never `withSystemContext`. Before writing, each existing target is re-resolved with
`findByIdOwned(target, owner)` and must be `DatasetSource` (else "data source not found" / "not a dataset"), so a
target owned by anyone else can never be written even if the config was persisted by some other path.

**D6 — Row mapping and validation.** Engine row `Map[String, Any]` → positional `Vector[JsValue]` in declaration
order via `PipelineRowJson.anyToJsValue`; an absent column → `JsNull` (validator applies required/default). Columns
present in rows but undeclared → fail naming them (sorted). Type, required and row-cap checks are the unchanged
`DatasetRowValidator` + `maxRows` logic inside the lock. `staticMaxRows` (private, DataSourceService.scala:64) moves to a
public `DataSourceService.DatasetMaxRows = 500` companion constant used by both the service and `PipelineRunService`. No coercion.

**D7 — New source, compare-and-set rewrite in the same transaction.** `cycleCheckForUpsertAction` becomes
`private[persistence]`, and a new `PipelineStepRepository.rewriteUpsertTargetAction(stepId, evaluatedConfig, ownerId)`
DBIO runs inside `applyWriteBacks`' single `withUserContext(owner)` transaction (app pool; `pipeline_steps_owner`
RLS, V35:63, admits the owner's SELECT/UPDATE under the GUC; asserted by test 3.7 under a NOBYPASSRLS role). Per
new-source write, in order: (1) `SELECT ... FROM pipeline_steps WHERE id = ? FOR UPDATE`; (2) compare the persisted
config to the evaluated one: identical `NewSource(name)` config → infer declaration from rows
(`SchemaInferenceEngine.inferShallowFromJsObjects`, column order = first appearance, every field `required = false`,
no default, all-null column `string`), `insertDatasetSourceAction(ownerId = owner)`, write rows, update the step
config to `ExistingSource(newId)` with the same mode, running `cycleCheckForUpsertAction(actingUserId = owner)`
first; persisted config is `ExistingSource(id)` with the evaluated mode AND that owned dataset's name equals the evaluated
`NewSource` name (a concurrent run already rewrote it) → write to `id` through the D5 ownership re-resolve instead,
creating nothing (skeptic-design-2 N1: a user repointing the step mid-run to a differently-named dataset fails instead); anything else (user edited the step
mid-run) → fail the run "step configuration changed during the run", nothing committed. The step-row lock
serializes a manual run racing a scheduled one, so exactly one dataset is ever created. Lock order is always step
row, then `data_sources`. **Zero rows:** a new-source target with zero rows is a no-op (no dataset, no rewrite:
nothing to infer a schema from); append with zero rows is a no-op; replace with zero rows clears the existing
dataset, matching `PUT .../rows` semantics.

**D8 — Analyze.** `PipelineAnalyzeService` inference: `upsertsource` joins the pass-through arm
(`filter | limit | ...`). `validateStepConfig` surfaces `requiredConfigProblems`. Downstream children of an
`upsertsource` step are allowed and see its input rows/schema.

**D9 — Frontend fallback.** In `stepNarrowing.ts` `pipelineStepToStep` (:247), an unknown `ps.type` maps to an
`OpType` built by a new `unsupportedOpType(type)` helper (`{ id: \`unsupported:${type}\`, label: \`Unsupported step
(${type})\`, icon: <lucide HelpCircle> }`), never `OP_TYPES[0]`; `OpType` (types/step.ts:15) is unchanged and the value
is never added to `OP_TYPES`, so the picker is unaffected. `config` is carried through untouched. An exported
`isUnsupportedOpType(opType)` predicate is used by `StepOpEditor` (renders a read-only notice instead of any config
editor) and by `useStepCardState.persist` (:207), which returns without calling `updatePipelineStep` for an unsupported
step. `utils/proposalLaneGraph.ts:50` inherits the same fallback via `pipelineStepToStep`; a proposal containing an
unknown op renders it as unsupported, not as the first op.

**D10 — Other enumerations.** Executor greps backend, frontend and `helio-mcp/` for every hardcoded op list
(`allowedOps`, prompt copy, MCP schemas) and records each as registered, deliberately excluded (HEL-1102 owns MCP)
with a reason, or not applicable, in `files-modified.md`.

## Risks / Trade-offs

- [Rows read into memory before write] → bounded by the 500-row cap, which fails early.
- [Inferred schema instability across runs of a new source] → only the first run infers; later runs validate.
- [Grantee writes into owner data] → approved product decision; audited as `data_source.rows.append|replace` with
  the triggering token/source.
- [MVCC claim wrong under some isolation] → mandatory concurrent-read test on a real Postgres; the reader is a single
  `SELECT` of the rows on a separate connection per iteration (mixing snapshots across statements would be a test artifact).
- [RLS masked by superuser CI connection] → RLS test runs the write under a NOBYPASSRLS role (RlsSharingAwareTablesSpec
  pattern), including a cross-tenant target that must fail.

## Migration Plan

No migration (V107 already allows the op). Rollback = revert; persisted `upsertsource` rows then fail registry
lookup as they did before HEL-1100.

## Planner Notes

Self-approved: D2 sink shape, D3 ordering + capability flag, D4 action refactor, D7 CAS/zero-row rules, D8 children
allowed, D9 naming. Round-1 design REFUTE (skeptic-design-1.md CR1-CR5, N1, N3) addressed in D1, D3, D6, D7, D9, Risks.
