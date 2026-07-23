## Why

Pipelines can now be run manually or fired by the scheduler (HEL-415), but `pipeline_runs` has no
column recording which path produced a run, so Run History cannot tell users why a run happened.
HEL-417 closes that gap by persisting and surfacing a trigger source per run.

## What Changes

- Add `pipeline_runs.trigger_source TEXT NOT NULL DEFAULT 'manual'` (Flyway `V63`) with a CHECK
  constraint allowing `manual`, `scheduled`, `external`. Existing rows backfill to `manual`.
- Thread a `TriggerSource` value through `PipelineRunService.submit`/`executeRun` and
  `PipelineRunRepository.insertRun`/`insertRunInternal`/`insertDryRun`/`insertDryRunInternal` so
  the manual API path persists `manual` and the HEL-415 scheduler callsite
  (`PipelineSchedulerService.fire`) persists `scheduled`. `external` is modeled now but has no
  caller yet (HEL-369 is out of scope).
- Add `triggerSource` to `PipelineRunRecord` (API response) and `PipelineRunRow` (persistence
  model); update `schemas/` with a new `pipeline-run-record.schema.json` (no schema currently
  documents this response shape) and update the relevant `openspec/` capability specs.
- Frontend: add `triggerSource` to the `PipelineRunRecord` TS type and render a provenance badge
  per row in `RunHistoryModal`.

## Capabilities

### New Capabilities

- `pipeline-run-provenance`: persisted `trigger_source` on `pipeline_runs`, threaded through
  submit/insert, surfaced on the run-history API response and rendered in the Run History UI.

### Modified Capabilities

- `pipeline-scheduler-runtime`: scheduled runs fired by `PipelineSchedulerService` now persist
  `trigger_source = 'scheduled'` (previously unspecified/implicitly `manual`-shaped).

## Impact

- Backend: `V63__pipeline_run_trigger_source.sql`; `PipelineRunRepository`, `PipelineRunService`,
  `PipelineSchedulerService` (pass `scheduled` explicitly), `PipelineProtocol`
  (`PipelineRunRecord` + format), `PipelineRunHistoryRoutes` (unchanged route, richer payload).
- Frontend: `pipelineStep.ts` (`PipelineRunRecord` type), `RunHistoryModal.tsx` + `.css`.
- Schemas/specs: new `schemas/pipeline-run-record.schema.json`; new
  `openspec/specs/pipeline-run-provenance/spec.md`; delta to `pipeline-scheduler-runtime`.
- Backward compatible: additive column with a default, additive response field — no existing
  contract narrows or changes shape.

## Non-goals

- HEL-369's external-hook trigger path (this ticket only reserves the `external` enum value).
- Filtering/sorting Run History by trigger source (display-only per acceptance criteria).
