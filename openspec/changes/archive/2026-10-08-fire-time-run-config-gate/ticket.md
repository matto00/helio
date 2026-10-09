# HEL-1384: Auto-run/scheduled-run config gates check only at write time: invalid-at-fire runs still submit; denied pipelines keep pending debounce rows

## Description

origin_kind: followup
origin_ticket: HEL-1279

HEL-1279 (c26c30567) skips dataset-write auto-run when an enabled step is misconfigured (`step-config-invalid`), reusing analyze's own `validateStepConfig`. Gaps its lane found (verify each):

1. The check runs only when the dataset is written, not when the scheduler fires the debounced run. A config made invalid during the debounce-plus-tick window still fires once. The existing HEL-1096 cost gate has the same gap.
2. Scheduled (cron) runs (`PipelineSchedulerService`) are not gated on config validity at all.
3. A debounce row already pending is not cleared if the pipeline is later denied. The same is true for cost denials.

## Acceptance criteria

* Decide where the gate belongs: write time, fire time, or both. Prefer one shared check at fire time if it covers all three. State in design whether a scheduled run of a misconfigured pipeline should be skipped and logged, or submitted to fail visibly. **If that changes what users see, escalate for an owner ruling.**
* Red-first tests for each gap that is fixed.
* Must not gate on schema-derived analyze errors (HEL-1280 false positives). Keep HEL-1279's guard test passing.

## Relations

Related: HEL-1279, HEL-1280, HEL-1096. Labels: Follow-up, Bug. Priority: Medium.
