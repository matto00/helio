# HEL-1279: Auto-run still submits pipelines that analyze reports as misconfigured (step-config-invalid)

## Description

origin_kind: followup
origin_ticket: HEL-1266

Reported by the HEL-1266 lane and not verified by the driver.

HEL-1266 made analyze report `canRun=false` with a `step-config-invalid` reason when an enabled step has a validationError. The auto-run path (`AutoRunTriggerService`, fired on dataset writes) does not see step-config errors, so it still submits runs that are certain to fail with HEL-1147's `STEP_CONFIG_INVALID`. Each failed run burns the owner's HEL-505 rate and concurrency budget.

## Acceptance Criteria

* Decide whether auto-run skips a misconfigured pipeline, recording a denial the same way HEL-1096 surfaces other denials, or submits and fails. Skipping is preferred.
* Reuse the analyze validation as a single source; do not add a parallel check.
* Red before the fix, green after.

## Driver context (claims, verified in premise-validation.md)

* Related open tickets: HEL-1280 (stale stored inferred schema can make analyze report canRun=false for a pipeline that WOULD run) and HEL-1267 (fillnull/window(lag)/pivot config checks not in the required-config validator). The auto-run gate must not turn HEL-1280's false negatives into blocked legitimate auto-runs.
* Concurrent lane HEL-1374 owns DatasetWriteAutoRunEndToEndSpec / PipelineRunGuardRepository — do not touch them. HEL-1371 (PipelineRunService split) is queued after this ticket — keep PipelineRunService edits minimal (ideally none).
