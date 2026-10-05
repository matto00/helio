## Context

See proposal.md - Why. Current code (main @ f09ba92f):

- `PipelineService.analyze` (~L1027-1075) builds `costVerdict` from `PipelineCostEstimator.estimate(costInput)` (a pure,
  op-name-only classifier shared with `AutoRunTriggerService` via `PipelineCostInputGathering`) plus a `canRunF` that is
  owner-or-editor-grant only. `toCostVerdictResponse(v, canRun)` copies `autoRunnable`/`reasons` from the estimator.
- The per-step `validationError` is already computed in the same method: `analyzed` = enabled steps' projections from
  `PipelineAnalyzeService.analyzeNodes` overlaid with `UpsertTargetAnalysis.overlay(..., upsertProblems)` (HEL-1265).
- Consumers of `costVerdict`/`canRun` (grep of backend/src/main, frontend/src, helio-mcp/src, e2e/):
  - Frontend: `PipelineDetailFooter.tsx:142-158` denial block (renders only when `!autoRunnable`; "Run to update" only
    when `canRun`), fed by `usePipelineDetailPage.ts` `costVerdict`; `estimatedRows` feeds the AI-step cost disclosure.
    The always-visible "Run pipeline"/"Dry run" buttons (footer ~L318-329) do NOT read `canRun`.
  - helio-mcp: `analyze_pipeline` passes JSON through verbatim; `types.ts` `CostVerdictResponse` omits `canRun`
    (drift). `analyze_pipeline_proposal` / `POST /api/pipelines/analyze-proposal` has no `costVerdict` at all.
  - Backend: `WorkspaceContextService` (L310) reads only `analyzed.steps`; no AssistantService/agent tool or
    apply-proposal path reads `costVerdict`/`canRun` (zero grep hits). `AutoRunTriggerService`'s `canRun` and the
    `DeniedPipelineResponse.canRun` are a SEPARATE field on the write response, computed independently.
  - Tests: `PipelineServiceCanRunSpec`, `PipelineAnalyzeRoutesSpec`, `PipelineDetailFooter.denial.test.tsx`,
    `PipelineDetailPage*.test.tsx`, `pipelinesSlice.test.ts`, `e2e/hel1096-run-to-update-affordance.spec.ts`,
    helio-mcp `context.test.ts` — all use fixtures with no step validationError; the executor re-verifies each.

## Goals / Non-Goals

**Goals:** `canRun` false + a named reason whenever an enabled step in the analyze response has a `validationError`;
schema/mcp type in sync; a seam test; red-first proof with a mutation.

**Non-Goals:** see proposal.md Non-goals. In particular `PipelineCostEstimator`, `AutoRunTriggerService`,
`PipelineRunService` and the denied-pipeline write response are NOT modified.

## Decisions

**D1 — Compute in `PipelineService.analyze`, not the estimator.** After `analyzed` is built, derive
`configReasons = analyzed.filter(_.validationError.nonEmpty).map(s => CostReasonResponse("step-config-invalid",
s.validationError.get, Some(s.id)))` (in `analyzed` order, i.e. enabled-step order). `toCostVerdictResponse` takes them,
appends them after the estimator's reasons, and sets `autoRunnable = v.autoRunnable && configReasons.isEmpty`,
`canRun = permitted && configReasons.isEmpty`. Alternative rejected: adding validation to `PipelineCostEstimator` — it is
pure and op-name-only by design and shared with the auto-run path, which has no analyze projection in scope; widening it
would drag `AutoRunTriggerService` (and the write response) into scope.

**D2 — Reason in `reasons`, not a new field.** The AC asks for "the reason included"; `reasons` already carries
`{code, detail, stepId}` and the frontend denial block already renders it. A separate `runBlockers` field was rejected:
new wire surface, new UI, and `canRun=false` would still need a reason channel. Consequence: such a pipeline reports
`autoRunnable=false`, which is also true in substance (an invalid pipeline cannot usefully auto-run), and preserves the
spec invariant "autoRunnable iff reasons empty".

**D3 — Permission stays inside `canRun`.** A viewer gets `canRun=false` with NO `step-config-invalid` reason (permission
is not a reason code today; unchanged). A consumer distinguishes the two causes by the presence of that code.

**D4 — Frontend: copy only.** Add `step-config-invalid` to `ALL_COST_REASON_CODES` and `DENY_REASON_COPY` ("A step in
this pipeline is misconfigured, so it can't run until that step is fixed."). The denial block then shows that sentence
and hides "Run to update" (canRun false). The always-visible "Run pipeline" button is NOT gated: it never read `canRun`,
HEL-1096 made not retrofitting it an explicit non-goal, the step card already shows the `validationError`, and HEL-1147
already maps a submitted run's failure to a clean `STEP_CONFIG_INVALID` reason. `denied-pipeline-response.schema.json`
is NOT changed (that path never emits the code); update `ALL_COST_REASON_CODES`'s doc comment to say the list is the
union, and check for any test asserting the list equals either schema enum verbatim.

**D5 — Seam test via one shared fixture.** One checked-in JSON fixture holds the analyze response's `costVerdict` for
a pipeline with one misconfigured enabled step (stable placeholder ids). Backend: a route test (in the existing
`PipelineAnalyzeRoutesSpec`, or a new spec extending `com.helio.testkit.HelioRouteTest`) creates that pipeline, calls the
real route, validates the body against `pipeline-analyze-response.schema.json`, and asserts the normalized
`costVerdict` equals the fixture. Frontend: a test imports the SAME file and renders the footer/denial block, asserting
the misconfigured-step copy and the absence of "Run to update". Either side drifting turns one test red. Fixture location
is the executor's call (must be readable from both `backend/` tests and jest; confirm jest JSON import works and that no
hygiene/schema-drift check rejects the path).

**D6 — helio-mcp.** Add `canRun: boolean` to `CostVerdictResponse` with a doc naming both conditions; extend the
`analyze_pipeline` description with one sentence: `costVerdict.canRun` is false when the caller may not run it or a step
has a `validationError` (reason code `step-config-invalid`). Update `context.test.ts`'s fixture to the full shape.

**D7 — PipelineRunService untouched.** Nothing here needs it; the HEL-1271 lane owns its run-success/snapshot region.

## Risks / Trade-offs

- [A `validationError` that would not actually fail a run now hides "Run to update"] → concretely: many analyze errors
  are derived from the root's stored `inferred_schema` ("Unknown field 'x'", PipelineAnalyzeService ~L665-952, assert
  rules ~L1100) and pivot/unpivot/window/fillnull checks not in the run-time validator (HEL-1267); a stale or empty
  inferred schema (e.g. a never-previewed rest_api root) can report canRun=false for a runnable pipeline. Only the
  denial-block control is affected; the main Run button still works. The ticket AC is explicit, so scope stays; no
  widening here (skeptic-design-1 note 1).
- [Duplicate copy] → the footer joins one sentence per reason; two misconfigured steps would repeat the same sentence.
  The footer dedupes identical sentences (skeptic-design-1 note 2).
- [Analyze `autoRunnable` now diverges from the auto-run path for invalid pipelines] → documented; auto-run of an
  invalid pipeline still fails as before. Candidate follow-up, triaged at Delivery.
- [Reason ordering] → estimator reasons first, then config reasons in enabled-step order; tests assert by content.

## Planner Notes

- Self-approved: D1-D7 (no new dependency, no breaking change — `canRun` stays a boolean, a new enum value is additive;
  helio-mcp passes through). No migration.
- Live repro (driver requirement) is task 1.1: the executor reproduces on the worktree's own backend port before any fix.
