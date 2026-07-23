# Files modified — HEL-416 (pipeline-schedule-config-ui)

Note: `git diff --name-only main...HEAD` in this worktree also lists the HEL-414/HEL-415 backend
files (schedule model, CRUD routes, scheduler runtime) — those commits already landed on this
branch before HEL-416 work started (per the ticket's "predecessor implementation notes") but the
local `main` ref in this worktree predates their merge to `origin/main`. None of those files were
touched by this change; the list below is scoped to what this ticket actually modified.

## New files

- `frontend/src/features/pipelines/types/pipelineSchedule.ts` — `ScheduleKind`, `PipelineSchedule`,
  `PutPipelineScheduleRequest` types mirroring `schemas/pipeline-schedule.schema.json` /
  `schemas/put-pipeline-schedule-request.schema.json` (task 1.1).
- `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx` — at-a-glance schedule bar
  ("No schedule set" / expression + enabled toggle + next-run), placed between `BoundTypeBar` and
  `PipelineRiverView` (design D1, task 3.1).
- `frontend/src/features/pipelines/ui/PipelineScheduleBar.css` — styling for the bar, matching the
  existing `pipeline-detail-page__source-bar`/`__type-bar` recipes.
- `frontend/src/features/pipelines/ui/PipelineScheduleDialog.tsx` — `Modal`-based set/edit/clear
  form: kind `Select`, interval n+unit friendly picker composing/decomposing `<n><unit>` (design
  D2), cron mono `TextField` with format hint, timezone `TextField` defaulted from the browser
  (design D3), enabled toggle, `InlineError` for save/validation errors (design D1a). Reads the
  already-loaded `schedule[pipelineId]` from Redux via a prop rather than fetching itself (design
  D1); dispatches `savePipelineSchedule`/`deletePipelineSchedule` on submit (task 3.2).
- `frontend/src/features/pipelines/ui/PipelineScheduleDialog.css` — dialog form/footer styling.
- `frontend/src/features/pipelines/ui/PipelineScheduleBar.test.tsx` — task 4.2 tests; cycle 2 added
  the evaluation-1 regression test (`nextRunAt` key omitted entirely, not set to `null`).
- `frontend/src/features/pipelines/ui/PipelineScheduleDialog.test.tsx` — task 4.3 tests.
- `frontend/src/features/pipelines/services/pipelineService.test.ts` — **cycle 2 (evaluation-1
  fix)**. Regression coverage, mirroring `dataTypeService.test.ts`'s established
  spray-json-omits-`None` pattern: `getPipelineSchedule`/`putPipelineSchedule` normalize an absent
  `nextRunAt`/`lastRunAt` wire key to `null`.

## Modified files

- `frontend/src/features/pipelines/services/pipelineService.ts` — added `getPipelineSchedule`,
  `putPipelineSchedule`, `deletePipelineSchedule` calling
  `GET/PUT/DELETE /api/pipelines/:id/schedule` (task 2.1). **Cycle 2 (evaluation-1 change request
  2)**: added `normalizeSchedule`, applied to both GET and PUT responses, coercing an absent
  `nextRunAt`/`lastRunAt` wire key to `null` (spray-json omits `Option = None` fields rather than
  serializing `null` — see `dataTypeService.ts`'s pre-existing `sourceId` precedent) so the
  declared `PipelineSchedule` type (`string | null`) matches what callers actually receive.
- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — added `schedule`, `scheduleStatus`,
  `scheduleError`, `scheduleSaveStatus`, `scheduleSaveError` to `PipelinesState`; added
  `fetchPipelineSchedule` (404 → `schedule: null` fulfilled, mirroring `dataTypesSlice.ts`'s
  409-branching precedent), `savePipelineSchedule`, `deletePipelineSchedule` thunks using the
  `isAxiosError` + `response.data.message` error-extraction pattern from `dashboardsSlice.ts` /
  `sourcesSlice.ts`; wired `extraReducers` so save/delete errors land in `scheduleSaveError`, not
  `scheduleError` (design D5) (tasks 2.2–2.5).
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — added the new schedule fields to
  the pre-existing `stateWithError` fixture (kept the file's own type-check green) and added the
  task 4.1 thunk/reducer test suites (`fetchPipelineSchedule`, `savePipelineSchedule`,
  `deletePipelineSchedule`, plus the D5 save-error-doesn't-clobber-schedule reducer test).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — wired `PipelineScheduleBar` +
  `PipelineScheduleDialog` between `BoundTypeBar` and `PipelineRiverView`; dispatches
  `fetchPipelineSchedule` on mount alongside the existing pipeline/steps/analyze fetches; added the
  bar's enabled-toggle handler that PUTs with the unchanged kind/expression/timezone (task 3.3).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added schedule-service mocks,
  extended `makeStore`'s preloaded `pipelines` state with the new schedule fields (required so the
  reducer's `state.schedule[pipelineId] = ...` extraReducers don't crash against a preloaded state
  missing those keys), and added the task 4.4 schedule-bar test suite.
- `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx` — **cycle 2 (evaluation-1 change
  request 1)**. `formatNextRun` now takes `string | null | undefined` and uses a nullish (`== null`)
  guard instead of `=== null`, so an absent `nextRunAt` (spray-json omits `Option = None` on the
  wire — see above) renders "no next run yet" instead of `new Date(undefined)`'s literal
  "Invalid Date" text. Root cause / probe / fix are documented inline in the function's comment.
