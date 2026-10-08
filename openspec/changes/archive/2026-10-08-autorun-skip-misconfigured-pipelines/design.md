## Context

See proposal.md (Why). Current state, re-derived from the tree at f9f38bb42:

- `AutoRunTriggerService.evaluateAndSchedule` (backend/src/main/scala/com/helio/services/pipelines/)
  builds a `CostInput` via `PipelineCostInputGathering.gather` and gates ONLY on
  `PipelineCostEstimator.estimate(...).autoRunnable`. Allowed -> `debounceRepo.upsertDebounce`;
  denied -> `handleDenied` (log + `EvaluatedPipeline.Denied(pipelineId, name, reasons, canRun)`,
  visibility-filtered by the writer's grant).
- Analyze's per-step `validationError` (`PipelineAnalyzeService.analyzeNodes`) is the union of three
  classes:
  1. `validateStepConfig(op, rawConfig)` — private; the step kind's own `validateRawConfig` +
     `requiredConfigProblems` + per-kind enum validators (stringops/fillnull/window/aggregate/
     groupby/pivot/union/join). Reads ONLY the raw config string — never a schema. Its own doc
     (HEL-859 Decision 5) states it re-checks the same `SupportedX` sets the engine checks, "so this
     can never reject a value the engine accepts"; `requiredConfigProblems` is literally the
     predicate `InProcessPipelineEngine` fails a run on (`StepConfigError` -> `STEP_CONFIG_INVALID`).
  2. `inferOutputSchema(...)` errors — computed against the input schema, which for root-level steps
     is the source's STORED `inferredSchema`. This is HEL-1280's false-positive class.
  3. `UpsertTargetAnalysis.overlay` — `upsertsource` target existence/writability. `upsertsource` is
     in `PipelineCostEstimator.WriteBackOps`, so such a pipeline is already never auto-runnable.
- `PipelineService.toCostVerdictResponse` (HEL-1266) maps every enabled step's `validationError` to
  a `CostReasonResponse("step-config-invalid", msg, Some(stepId))`, appended after the estimator's
  reasons, and clears `autoRunnable` and `canRun`. The code string lives in
  `PipelineService`'s companion as a `private val`.
- Frontend: `denyReasonCopy.ts` already maps `step-config-invalid`; `deniedPipelinesToast.ts`
  offers "Run to update" only when exactly one pipeline is denied and its `canRun` is true.

## Goals / Non-Goals

**Goals:**
- A dataset write never schedules an auto-run for a pipeline with a misconfigured ENABLED step.
- The config check is the analyze validator itself (single source), not a re-implementation.
- HEL-1280 cannot regress auto-run: schema-derived validation errors never deny auto-run.

**Non-Goals:**
- Re-checking configuration at the scheduler's claim-and-fire tick (a config edited to invalid in
  the <= debounce + tick window after a write still fires; the run fails exactly as today). The
  existing cost gate is likewise write-time-only; extending both to fire time is a follow-up.
- Gating cron/scheduled (`TriggerSource.Scheduled`) or manual runs on config validity.
- HEL-1267 (moving fillnull/window-lag/pivot in-step checks into the validator) and HEL-1280
  (stale-schema false positives in analyze). This change composes with both: once HEL-1267 lands,
  its new checks flow into the auto-run gate automatically through the shared validator.
- Any change to `PipelineRunService`, `PipelineRunGuardRepository`, `DatasetWriteAutoRunEndToEndSpec`
  (concurrent lanes HEL-1371 / HEL-1374), the debounce table, or migrations.
- Row-delete's fire-and-forget path: it keeps logging denials only (existing spec carve-out); it
  simply also stops scheduling misconfigured pipelines, since it shares `evaluateAndSchedule`.

## Decisions

### D1. Skip (deny), don't submit-and-fail
The ticket states skipping is preferred and that the denial is surfaced "the same way HEL-1096
surfaces other denials". A misconfigured run is certain to fail and costs the owner HEL-505 budget,
so skipping is strictly better. This is the ticket author's recorded product decision, so it is
self-approved here, not escalated. User-visible effect: a write that previously silently queued a
doomed run now returns a `deniedPipelines` entry whose copy ("A step in this pipeline is
misconfigured, so it can't run until that step is fixed.") already exists in the frontend.

### D2. Gate on the schema-independent config class only (HEL-1280 safety)
Expose analyze's existing `validateStepConfig` as a public entry point on `PipelineAnalyzeService`
(e.g. `stepConfigProblem(op: String, rawConfig: String): Option[String]`) — the SAME function
`analyzeNodes` calls for every enabled node, unchanged — and call it once per enabled step from
`AutoRunTriggerService` with `PipelineStepConfigCodec.encode(step)` (the raw-config encoding analyze
and the engine both use).

Alternatives rejected:
- Run full `analyzeNodes` with root schemas and gate on every `validationError` (literally reusing
  `toCostVerdictResponse`'s input). Rejected: class 2 errors derive from the stored inferred schema,
  so every HEL-1280 false positive would silently stop a legitimate auto-run — converting a Low-
  severity analyze display issue into lost data freshness. It would also add root-schema and
  secondary-schema lookups to every dataset write.
- A new validator in `AutoRunTriggerService`. Rejected by the AC (no parallel check).

Why per-step is exactly analyze's answer for this class: `validateStepConfig` takes only
`(op, rawConfig)`; in `analyzeNodes` it runs for every enabled node before inference and a disabled
node is never validated. So `enabledSteps.flatMap(s => stepConfigProblem(...))` yields precisely the
class-1 subset of analyze's `validationError`s. (A node analyze never reaches because of a dangling
parent/lane reference is absent from analyze's response but would still be checked here; such a
pipeline cannot run either, so denying it is not a false negative.)

### D3. One reason-code constant, one reason shape, one ordering
Move the `"step-config-invalid"` code to a single public constant (on `PipelineAnalyzeService`'s
companion, the validator's owner) referenced by both `PipelineService.toCostVerdictResponse` and
`AutoRunTriggerService`. Reasons are `PipelineCostEstimator.CostReason(code, message, Some(stepId))`,
appended AFTER the estimator's reasons, in `enabledSteps` order — the ordering analyze uses.

### D4. Combined verdict and `canRun`
`autoRunnable = verdict.autoRunnable && configReasons.isEmpty`. On deny, `handleDenied` receives the
combined reasons. A `Denied` entry with any config reason has `canRun = false` (the writer's ACL
result is ANDed with `configReasons.isEmpty`), mirroring analyze's
`canRun = canRun && configReasons.isEmpty`. Visibility filtering (owner / any grant / none) is
unchanged — config reasons never make an invisible pipeline visible. The log line includes the
config reasons like any other.

### D5. Contract
`schemas/sources/denied-pipeline-response.schema.json`: add `step-config-invalid` to
`CostReason.code`'s enum and amend `canRun`'s description ("...and false whenever a
`step-config-invalid` reason is present"). Additive for consumers. Update `denyReasonCopy.ts`'s
comment that says `step-config-invalid` is analyze-only, if it is now inaccurate (copy unchanged).

## Testing strategy (Iron Law: red before green)

- RED first in `AutoRunTriggerServiceSpec` (existing suite; NOT `DatasetWriteAutoRunEndToEndSpec`):
  a dataset-rooted pipeline whose only step is a cheap op with a missing required config (e.g.
  `compute` with empty `column`, confirmed persistable per HEL-814 D2) is today evaluated `Allowed`
  and a debounce row is upserted. Capture that failing assertion output before the fix.
- After the fix: `Denied` with a `step-config-invalid` reason (stepId set), `canRun = false` for the
  owner, no debounce row.
- HEL-1280 guard: a cheap-op pipeline whose step references a column absent from the stored inferred
  schema such that analyze reports a schema-derived (class 2) `validationError` — first PROVE via
  `PipelineAnalyzeService.analyzeNodes` in the test that analyze really flags it — and assert auto-run
  is still `Allowed`. Mutation-check: temporarily gating on full `analyzeNodes` must turn this red.
- Disabled-misconfigured-step scenario stays `Allowed`.
- Cost + config combined: AI step + misconfigured step -> both reasons, cost first, `canRun=false`.
- Single-source proof: a test that `PipelineService`'s analyze and the auto-run gate produce the
  same `step-config-invalid` reasons for the same config-invalid pipeline (or, minimally, that both
  reference the shared constant and validator — grep evidence in the report).
- Write-response surface: extend `DataSourceServiceDeniedPipelinesSpec` with one append-write case
  carrying `step-config-invalid` and `canRun:false` on the wire.
- Gates: `sbt testOnly` for the touched specs, then `sbt testFull`; frontend `npm test` only if a
  frontend file changes. Never bare `sbt test`.

## Risks / Trade-offs

- [A config validator false positive would now block auto-run] -> class 1 is, up to one known edge
  case, a subset of what the engine rejects (HEL-859 D5; `requiredConfigProblems` is the engine's own
  predicate; design-gate skeptic spot-checked every per-kind validator). Edge case: `AggregateStep`
  checks its function name only inside its per-group loop, so an aggregate with `groupBy` set and an
  unsupported function "succeeds" with zero rows on EMPTY input while the validator denies it. No
  practical impact (analyze already reports canRun=false for it; on any non-empty input the run fails).
- [Extra work per write] -> pure in-memory string validation over already-loaded steps; no new DB
  calls.
- [HEL-1267 gap remains] -> fillnull/window-lag/pivot misconfigs only caught in-step still auto-submit
  and fail, as today; resolved automatically when HEL-1267 lands.
- [Fire-time window] -> see Non-Goals; follow-up candidate.

## Migration Plan

None (no DB change). Rollback = revert the commit.
