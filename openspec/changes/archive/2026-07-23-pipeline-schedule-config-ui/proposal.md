## Why

HEL-414 (schedule model + CRUD routes) and HEL-415 (scheduler runtime) landed the backend for
per-pipeline cron/interval schedules, but there is no way to set one from the app — a user has to
call the REST API directly. This ticket closes that gap with a schedule config surface in the
pipeline editor.

## What Changes

- Add a "Schedule" section to the pipeline editor (`PipelineDetailPage.tsx` /
  `PipelineDetailFooter.tsx`) letting a user set, edit, enable/disable, and clear a pipeline's
  schedule: kind (interval or cron) picker, expression input, IANA timezone picker, enabled
  toggle, and a read-only next-run display.
- Inline validation messages for malformed cron/interval expressions and invalid timezones,
  surfaced from the backend's 400 responses (mirrors HEL-414's hand-rolled validation) without
  duplicating that logic client-side.
- Service functions (`getPipelineSchedule`, `putPipelineSchedule`, `deletePipelineSchedule`) in
  `pipelineService.ts` calling `GET/PUT/DELETE /api/pipelines/:id/schedule`.
- Redux wiring in `pipelinesSlice.ts`: fetch-on-mount, save (upsert), and delete thunks plus
  per-pipeline schedule state, mirroring the existing `currentPipeline`/`updateStatus` pattern.
- Pipelines without a schedule (the common case today) render exactly as before — the new section
  shows an inert "No schedule set" affordance rather than blocking or altering existing layout.

## Capabilities

### New Capabilities

- `pipeline-schedule-config-ui`: the frontend schedule config surface on the pipeline editor —
  set/edit/enable/disable/clear a schedule, inline validation display, and the next-run readout.

### Modified Capabilities

(none — this is additive UI; no existing capability's requirements change)

## Non-goals

- The scheduler runtime itself (already shipped, HEL-415) and run provenance labeling (sibling
  ticket, HEL-417).
- Generic design-system work (new shared components) — reuse existing `Select`/`TextField`/
  `InlineError`/`Modal` primitives and the plain `<input type="checkbox">` pattern per `DESIGN.md`.
- Client-side re-implementation of the backend's cron/interval grammar validation — errors surface
  from the 400 response body.

## Impact

- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`,
  `PipelineDetailFooter.tsx` (or a new co-located `PipelineScheduleSection.tsx`).
- `frontend/src/features/pipelines/services/pipelineService.ts` — new schedule CRUD calls.
- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — new schedule state + thunks.
- `frontend/src/features/pipelines/types/pipelineStep.ts` (or a new `types/pipelineSchedule.ts`) —
  `PipelineSchedule` / `PutPipelineScheduleRequest` frontend types mirroring
  `schemas/pipeline-schedule.schema.json` / `schemas/put-pipeline-schedule-request.schema.json`.
- No backend changes; consumes the existing HEL-414 routes as-is.
