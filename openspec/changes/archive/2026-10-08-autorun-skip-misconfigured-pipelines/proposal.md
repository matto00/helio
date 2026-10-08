## Why

A dataset write auto-runs every downstream pipeline whose cost verdict is `autoRunnable`, but that
verdict never looks at step configuration. A pipeline with a savable-but-unrunnable draft step
(HEL-814 D2 deliberately lets e.g. a `compute` with an empty `column` save) is therefore debounced
and submitted on every write, fails with `STEP_CONFIG_INVALID`, and burns the pipeline owner's
HEL-505 rate/concurrency budget — even though analyze (HEL-1266) already reports the same pipeline
as `step-config-invalid` / `canRun=false`.

## What Changes

- The dataset-write auto-run eligibility check denies (skips) a pipeline when any enabled step has a
  step-configuration problem, using the SAME config validator analyze uses — no parallel check.
- Such a denial is surfaced exactly like every other HEL-1096 denial: logged, and returned in the
  write response's `deniedPipelines` with reason code `step-config-invalid` naming the step (after
  any cost reasons, in step order — the analyze ordering).
- A denied entry carrying a `step-config-invalid` reason reports `canRun: false`, mirroring analyze
  (HEL-1266): a manual "Run to update" would be certain to fail, so it is not offered.
- Only the schema-INDEPENDENT config class gates auto-run. Validation errors derived from a source's
  stored inferred schema (HEL-1280's false-positive class) do NOT block auto-run.
- `schemas/sources/denied-pipeline-response.schema.json` adds `step-config-invalid` to the
  `CostReason.code` enum and updates the `canRun` description.

## Capabilities

### New Capabilities

### Modified Capabilities
- `dataset-write-auto-run`: the cheapness-verdict requirement additionally denies a pipeline with a
  misconfigured enabled step, reports it as `step-config-invalid`, and clears `canRun` for it.

## Impact

- Backend: `AutoRunTriggerService` (eligibility), `PipelineAnalyzeService` (expose its existing
  config validator), shared reason-code constant with `PipelineService`. No change to
  `PipelineRunService`, `PipelineRunGuardRepository`, the scheduler tick, or the DB schema.
- Contract: `denied-pipeline-response.schema.json` enum gains one value (additive).
- Frontend: none expected — `denyReasonCopy` already maps `step-config-invalid` and the toast already
  hides "Run to update" when `canRun` is false.
