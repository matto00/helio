## 1. ### Backend — migration

- [x] 1.1 Verify next available VNN in this worktree (expect V63); add
      `backend/src/main/resources/db/migration/V63__pipeline_run_trigger_source.sql` adding
      `pipeline_runs.trigger_source TEXT NOT NULL DEFAULT 'manual'` with a CHECK constraint
      restricting to `manual`/`scheduled`/`external`.

## 2. ### Backend — persistence + service

- [x] 2.1 Add `triggerSource: String` to `PipelineRunRepository.PipelineRunRow` and the
      `PipelineRunTable` Slick mapping.
- [x] 2.2 Thread `triggerSource: String` through `insertRun`, `insertRunInternal`, `insertDryRun`,
      `insertDryRunInternal` in `PipelineRunRepository`.
- [x] 2.3 Add a `TriggerSource` constants holder (`Manual`/`Scheduled`/`External` string literals)
      near `PipelineRunService`; thread `triggerSource: String = TriggerSource.Manual` through
      `submit` → `runPipeline` → `executeRun` → `insertRun`/`insertDryRun` calls.
- [x] 2.4 Update `PipelineSchedulerService.fire` to call
      `pipelineRunService.submit(schedule.pipelineId, isDry = false, owner, triggerSource =
      TriggerSource.Scheduled)`.
- [x] 2.5 Add `triggerSource: String` to `PipelineRunRecord` in `PipelineProtocol.scala`; update
      `pipelineRunRecordFormat` (`jsonFormat7` → `jsonFormat8`); populate it in
      `PipelineRunService.history` from `PipelineRunRow.triggerSource`.

## 3. ### Backend — schemas/openspec

- [x] 3.1 Add `schemas/pipeline-run-record.schema.json` documenting the full `PipelineRunRecord`
      response shape including `triggerSource` (enum `manual`/`scheduled`/`external`).

## 4. ### Frontend

- [x] 4.1 Add `triggerSource: "manual" | "scheduled" | "external"` to the `PipelineRunRecord`
      interface in `frontend/src/features/pipelines/types/pipelineStep.ts`.
- [x] 4.2 Render a provenance badge per row in `RunHistoryModal.tsx` (e.g. next to `StatusBadge`);
      add corresponding styles in `RunHistoryModal.css` following the existing status-badge
      pattern (capitalize, muted-border pill).
- [x] 4.3 Normalize `triggerSource` at the service boundary in `pipelineService.ts`'s
      `fetchRunHistory` in case any legacy/mocked response omits the field (spray-json
      Option=None-omission precedent from HEL-416) — default missing values to `"manual"`.

## 5. ### Tests

- [x] 5.1 `PipelineRunRepositorySpec`: assert `insertRun`/`insertRunInternal` persist the passed
      `triggerSource`; assert `insertDryRun`/`insertDryRunInternal` persist `manual`.
- [x] 5.2 Backend test (service or route level) asserting `PipelineRunService.submit` without an
      explicit `triggerSource` defaults to `manual`, and `PipelineRunService.history` surfaces
      `triggerSource` on returned `PipelineRunRecord`s.
- [x] 5.3 `PipelineSchedulerService` test asserting a scheduler-fired run is persisted with
      `trigger_source = 'scheduled'`.
- [x] 5.4 Migration smoke test (or existing Flyway test harness) confirming `V63` applies cleanly
      and backfills pre-existing rows to `manual`.
- [x] 5.5 Frontend test for `RunHistoryModal` rendering the provenance badge for `manual` and
      `scheduled` runs.
