## Why

HEL-1279 and HEL-1096 gate dataset-write auto-run on step-config validity and cost, but only when the dataset is written. The scheduler tick that actually fires a debounced auto-run never re-checks, and scheduled (cron) runs are not gated on config validity at all. A pipeline made invalid after its schedule or debounce was set up still submits. That spends the owner's HEL-505 run budget on a run that is certain to fail. Save-time validation (HEL-1402/1416 `validateRawConfig`) does not close this: save deliberately accepts draft steps with empty required config (HEL-814 D3, "legitimate to save is not legitimate to run"), and turning a step on is not re-checked.

## What Changes

- One shared, schema-independent step-config check (analyze's `PipelineAnalyzeService.stepConfigProblem`, the same one HEL-1279 uses) is evaluated at FIRE time on both scheduler paths. It never uses analyze's schema-derived errors (the HEL-1280 false-positive class).
- **Scheduled (cron) fire, owner ruling Q1 = record-failed-run:** when any enabled step is misconfigured at fire time, the run is NOT executed and does NOT touch the HEL-505 rate-limit or concurrency budget. A failed run is persisted with the step-config reason and `trigger_source = scheduled` (via the existing `recordUnrunnable` "never attempted" pattern), the pipeline's last-run status becomes `failed`, and the schedule advances (`next_run_at` recomputed, `last_run_at = now`) exactly as for a normal fire.
- **Debounced auto-run fire, owner ruling Q2 = skip-and-log:** at claim time the scheduler re-evaluates the SAME verdict the write-time trigger computes (HEL-1096 cost verdict plus HEL-1279 config reasons). A denied pipeline is not submitted, the denial reasons are logged, and the claim is released (the debounce row is removed). This also covers gap 3: a pending row left by an earlier allowed write cannot fire once the pipeline is denied.
- **Owner ruling Q3 = no:** scheduled runs are NOT cost-gated.
- No change to write-time behaviour or to the write-response `deniedPipelines` contract. The HEL-1279 guard test stays green.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-scheduler-runtime`: a due schedule whose pipeline has a misconfigured enabled step records a failed never-attempted run instead of submitting.
- `dataset-write-auto-run`: the auto-run eligibility verdict is re-evaluated when the debounced run fires; a pipeline denied at fire time is skipped and logged, and its debounce row is released.

## Impact

- Backend only. `PipelineSchedulerService` (both fire paths), `AutoRunTriggerService` (verdict extracted for reuse at fire time), `PipelineRunService.recordUnrunnable` (optional trigger source), wiring in `Main.scala`/`ApiRoutes.scala`, and the scheduler test fixture.
- No Flyway migration, no API or schema change, no frontend change.
- RLS: fire-time reads use the existing privileged `*Internal` repository methods already used by the write-time trigger and the scheduler. The never-attempted run writes go through the same owner-scoped `withUserContext(owner)` repository calls that a scheduled `submit` already uses for its run row.
