## 1. Frontend — Types

- [x] 1.1 Add `frontend/src/features/pipelines/types/pipelineSchedule.ts`: `ScheduleKind`
      (`"cron" | "interval"`), `PipelineSchedule` (mirrors
      `schemas/pipeline-schedule.schema.json`), `PutPipelineScheduleRequest` (mirrors
      `schemas/put-pipeline-schedule-request.schema.json`).

## 2. Frontend — Service + State

- [x] 2.1 Add `getPipelineSchedule`, `putPipelineSchedule`, `deletePipelineSchedule` to
      `frontend/src/features/pipelines/services/pipelineService.ts` calling
      `GET/PUT/DELETE /api/pipelines/:id/schedule`.
- [x] 2.2 In `frontend/src/features/pipelines/state/pipelinesSlice.ts`: add
      `schedule: Record<string, PipelineSchedule | null>`, `scheduleStatus`, `scheduleError`,
      `scheduleSaveStatus`, `scheduleSaveError` to `PipelinesState`.
- [x] 2.3 Add `fetchPipelineSchedule` thunk (GET); a 404 response resolves `fulfilled` with
      `schedule: null` (mirror `dataTypesSlice.ts`'s 409-branching precedent for expected non-2xx
      states), any other error rejects.
- [x] 2.4 Add `savePipelineSchedule` thunk (PUT) and `deletePipelineSchedule` thunk (DELETE), both
      using the `isAxiosError` + `response.data.message` error-extraction pattern from
      `dashboardsSlice.ts` / `sourcesSlice.ts`.
- [x] 2.5 Wire `extraReducers` for all three thunks per design D5 (save/delete errors land in
      `scheduleSaveError`, not `scheduleError`, so a failed save doesn't clobber the last-loaded
      schedule).

## 3. Frontend — UI

- [x] 3.1 Create `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx` +
      `PipelineScheduleBar.css`: "No schedule set" / "Set schedule" state, or expression + enabled
      toggle + next-run readout + "Edit schedule" state (design D1). Next-run formatted via
      `toLocaleString({ dateStyle: "medium", timeStyle: "short" })`.
- [x] 3.2 Create `frontend/src/features/pipelines/ui/PipelineScheduleDialog.tsx` +
      `PipelineScheduleDialog.css`: `Modal`-based form (kind `Select`, interval n+unit
      `TextField`+`Select` friendly picker, cron mono `TextField` with format hint, timezone
      `TextField` defaulted from `Intl.DateTimeFormat().resolvedOptions().timeZone` for new
      schedules), enabled toggle, `InlineError` for save/validation errors, Save + "Clear schedule"
      (existing only) + Cancel actions. Local `open`/`saving`/`error` state only (mirrors
      `PipelineShareDialog.tsx`'s UI-state shape) — the dialog does **not** fetch; it initializes
      its fields from the already-loaded `schedule[pipelineId]` Redux state (design D1) and only
      dispatches on submit. On edit, decompose a persisted `interval` expression back into number +
      unit fields via the same `^(\d+)(s|m|h|d)$` shape the backend validates against (design D2).
- [x] 3.3 Wire `PipelineScheduleBar` + `PipelineScheduleDialog` into `PipelineDetailPage.tsx`
      between `BoundTypeBar` and `PipelineRiverView`; fetch the schedule on mount alongside the
      existing pipeline/steps fetches.

## 4. Tests

- [x] 4.1 `pipelinesSlice.test.ts`: `fetchPipelineSchedule` (found, 404→null, other error→reject),
      `savePipelineSchedule` (success, 400 message surfaced), `deletePipelineSchedule`
      (success, error).
- [x] 4.2 `PipelineScheduleBar.test.tsx`: no-schedule state, enabled+next-run state, disabled
      state, enabled-toggle calls save with unchanged kind/expression/timezone.
- [x] 4.3 `PipelineScheduleDialog.test.tsx`: create (interval picker composes `<n><unit>`), edit
      pre-fills fields from Redux state (no GET call from the dialog itself), save calls PUT,
      clear calls DELETE, `InlineError` rendered with the backend's message on 400 without closing
      the dialog or clearing input.
- [x] 4.4 `PipelineDetailPage.test.tsx`: schedule bar renders for a pipeline with no schedule
      (existing layout unaffected) and for one with a schedule.
