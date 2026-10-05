## Why

`GET /api/pipelines/:id/analyze` reports a step's `validationError` while `costVerdict.canRun` stays `true`, because
`canRun` is computed purely as an owner-or-editor permission bit (HEL-1096). Any caller that trusts `canRun` (the
pipeline page's "Run to update" control, an MCP agent reading `analyze_pipeline`) is told a run is possible when
analyze already knows a step is misconfigured (typically failing with `STEP_CONFIG_INVALID`, HEL-1147). Not every
analyze `validationError` is guaranteed to fail at run time (see design.md Risks); the AC binds anyway. See ticket.md.

## What Changes

- `costVerdict.canRun` becomes "permitted AND no enabled step has a `validationError`".
- Each enabled step with a `validationError` contributes one `costVerdict.reasons` entry with the new code
  `step-config-invalid`, `stepId` = that step, `detail` = its validation error text. Because `autoRunnable` is true iff
  `reasons` is empty, such a pipeline is also reported not auto-runnable.
- JSON schema (`pipeline-analyze-response.schema.json`) gains the new code; frontend deny-copy mapping gains a
  sentence for it; helio-mcp's `CostVerdictResponse` type gains the missing `canRun` field and the tool description
  names `canRun`.
- A seam test ties the backend's real analyze JSON for this case to the fixture the frontend test renders.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-analyze-api`: the cost-verdict requirement's `canRun` definition and reason-code list change.
- `run-to-update-affordance`: the pipeline page names a misconfigured step and offers no "Run to update" for it.

## Non-goals

- The proposal-mode analyze response — it carries no `costVerdict` at all (unchanged).
- The always-visible "Run pipeline"/"Dry run" buttons — they never read `canRun` (unchanged).
- `AutoRunTriggerService`/`PipelineCostEstimator` and the denied-pipeline write response — the auto-run path does not
  run analyze validation; aligning it is a possible follow-up, not this ticket.
- Moving fillnull/window/pivot checks into the required-config validator (HEL-1267).
- `PipelineRunService` (untouched). No migration.

## Impact

`PipelineService.analyze`, `PipelineAnalyzeProtocol` doc, `schemas/pipelines/pipeline-analyze-response.schema.json`,
`frontend/src/features/pipelines/services/denyReasonCopy.ts`, `helio-mcp/src/types.ts` + `tools/read.ts`, tests.
