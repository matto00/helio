## Backend

- `backend/src/main/resources/db/migration/V63__pipeline_run_trigger_source.sql` — new migration:
  adds `pipeline_runs.trigger_source TEXT NOT NULL DEFAULT 'manual'` + a CHECK constraint
  (`manual`/`scheduled`/`external`); `NOT NULL DEFAULT` backfills pre-existing rows in the same
  statement.
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — added
  `triggerSource: String` to `PipelineRunRow` and the `PipelineRunTable` Slick mapping; threaded a
  `triggerSource: String = "manual"` parameter through `insertRun`/`insertRunInternal`;
  `insertDryRun`/`insertDryRunInternal` hardcode `"manual"` (dry runs are always interactive).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — added the `TriggerSource`
  constants object (`Manual`/`Scheduled`/`External`); threaded `triggerSource: String =
  TriggerSource.Manual` through `submit` → `runPipeline` → `executeRun` → `insertRun`; populated
  `PipelineRunRecord.triggerSource` in `history` from the persisted row.
- `backend/src/main/scala/com/helio/services/PipelineSchedulerService.scala` — `fire` now passes
  `triggerSource = TriggerSource.Scheduled` explicitly to `pipelineRunService.submit`.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — updated the dormant
  Spark-driver `insertRunInternal` callsite to pass `TriggerSource.Manual` (this path has no route
  wired in yet — HEL-202 — and carries no `triggerSource` parameter of its own; defaulted to manual
  to keep it consistent and unblock compilation).
- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` — added
  `triggerSource: String` to `PipelineRunRecord`; `pipelineRunRecordFormat` `jsonFormat7` →
  `jsonFormat8` (spray-json's `jsonFormatN` binds by case-class field name via the `apply` method,
  not position, so the added field does not disturb existing field ordering/binding).

## Backend tests

- `backend/src/test/scala/com/helio/infrastructure/PipelineRunRepositorySpec.scala` — asserted
  `insertRun` persists `triggerSource: "manual"` by default; added dedicated tests for
  `insertRun`/`insertRunInternal` persisting an explicit `triggerSource`
  (`"scheduled"`/`"external"`), and `insertDryRun`/`insertDryRunInternal` always persisting
  `"manual"`.
- `backend/src/test/scala/com/helio/infrastructure/TriggerSourceMigrationSpec.scala` — new
  two-stage Flyway migration test (mirrors `PipelineOnlyPanelBindingMigrationSpec`'s pattern):
  migrates to V62, seeds a pre-V63 `pipeline_runs` row, migrates to V63+, and asserts the row
  backfills to `trigger_source = 'manual'`; asserts a valid insert (`'scheduled'`) succeeds and an
  invalid value is rejected by the CHECK constraint.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — added
  `triggerSource` assertions to the existing manual-run, dry-run, and run-history route tests
  (defaults to `"manual"` end to end through `PipelineRunSubmitRoutes` → `PipelineRunService.submit`
  → repository → history response).
- `backend/src/test/scala/com/helio/services/PipelineSchedulerServiceSpec.scala` — added
  `triggerSource shouldBe "scheduled"` assertions to the due-interval-fire and
  failed-scheduled-run tests.

## Schemas / OpenSpec

- `schemas/pipeline-run-record.schema.json` — new schema documenting the full `PipelineRunRecord`
  response shape (no schema previously existed for this response), including `triggerSource` as
  the `manual`/`scheduled`/`external` enum; field set matches `PipelineRunRecord` exactly per
  `scripts/check-schema-drift.mjs`'s parity check.
- `openspec/changes/pipeline-run-trigger-provenance/` — proposal/design/tasks/specs (delta specs
  for the new `pipeline-run-provenance` capability and the modified `pipeline-scheduler-runtime`
  capability were already drafted during planning; `tasks.md` checked off as work completed here).

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — added
  `triggerSource: "manual" | "scheduled" | "external"` to the `PipelineRunRecord` interface.
- `frontend/src/features/pipelines/services/pipelineService.ts` — added `normalizeRunRecord`
  (defaults a missing `triggerSource` to `"manual"`) and applied it in `fetchRunHistory`, mirroring
  the existing `normalizeSchedule` Option=None-omission defensive pattern.
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx` — added a `TriggerSourceBadge` component
  rendered per row next to `StatusBadge` (labels: Manual/Scheduled/External).
- `frontend/src/features/pipelines/ui/RunHistoryModal.css` — added `.run-history-modal__trigger`
  base pill style plus `--scheduled` (accent) and `--external` (warning) color variants, following
  the existing status-badge token pattern (`--app-accent`/`--app-warning` + `-surface` washes).

## Frontend tests

- `frontend/src/features/pipelines/services/pipelineService.test.ts` — added
  `fetchRunHistory` normalization tests (missing `triggerSource` defaults to `"manual"`; a present
  value is preserved).
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — added `triggerSource: "manual"`
  to the shared `sampleRun` fixture (required field).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added `triggerSource` to all
  `PipelineRunRecord` fixtures (required field); added two new tests asserting the Manual/Scheduled
  provenance badges render in the Run History modal.
