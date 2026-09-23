# Files Modified — HEL-1093 (auto-run-trigger-debounced)

## Backend — schema

- `backend/src/main/resources/db/migration/V110__pipeline_auto_run_debounce.sql` — new
  `pipeline_auto_run_debounce` table (FORCE RLS, V62 indirect-owner pattern); widens
  `pipeline_runs_trigger_source_check` to admit `'auto-run'`.

## Backend — persistence

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineAutoRunDebounceRepository.scala`
  (new) — `upsertDebounce` (forward-only UPSERT), `claimDue` (atomic `UPDATE ... RETURNING`),
  `releaseClaim` (compare-and-delete).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRootRepository.scala`
  — new `listPipelineIdsForDataSourceInternal`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — new `findLastRunRowCountInternal`.

## Backend — services

- `backend/src/main/scala/com/helio/services/pipelines/PipelineCostInputGathering.scala` (new) —
  shared root-list/dataset-row-count/`CostInput` assembly with a caller-supplied `resolveRoot`
  (design.md Decision 2a — design-gate round 1 fix); also hosts `hasSourceUrl` (moved out of
  `PipelineService`).
- `backend/src/main/scala/com/helio/services/pipelines/AutoRunTriggerService.scala` (new) —
  write-time eligibility evaluation + debounce UPSERT; never submits a run synchronously.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — added
  `TriggerSource.AutoRun`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala` — new
  claim-and-fire pass piggybacked on the existing tick; `AuthenticatedUser(pipeline.ownerId, ...)`
  synthetic-owner pattern mirrored from `fire`; guard rejections logged, never thrown.
  New nullable `autoRunDebounceRepo`/`staleClaimAfterSeconds` constructor params.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `analyze` now
  calls the shared `PipelineCostInputGathering.gather` (behavior-preserving refactor) instead of
  inlining root-list/dataset-row-count/`CostInput` assembly.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — new nullable
  `autoRunTriggerService` constructor param; new private `triggerAutoRun` helper (fire-and-forget,
  `.recover`-wrapped) called from `appendRows`/`appendFormRow`/`replaceRows`/`patchRow`/`deleteRow`
  on the successful-write branch only.

## Backend — wiring

- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — new nullable `autoRunDebounceRepo`
  constructor param; builds `autoRunTriggerServiceOpt` and threads it into `dataSourceService`.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs the shared
  `PipelineAutoRunDebounceRepository` once, passes it to both `ApiRoutes` and
  `PipelineSchedulerService` (mirrors `pipelineRunGuardRepo`'s existing shared-instance wiring).

## Backend — tests

- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` — added
  `pipeline_auto_run_debounce` to the `rlsTables` allowlist.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineAutoRunDebounceRepositorySpec.scala`
  (new) — repository unit tests (upsert forward-only/claim reset, atomic claim, compare-and-delete
  release) + the RLS probe (tasks.md 3.5), dual-pool `helio_app_test` harness.
- `backend/src/test/scala/com/helio/services/pipelines/AutoRunTriggerServiceSpec.scala` (new) —
  eligibility evaluation (tasks.md 3.1), multi-root mixed-ownership (3.10), non-cascade via
  `applyWriteBacks` (3.8).
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunCoalescingSpec.scala`
  (new) — the ticket's headline AC: single-instance debounce coalescing (3.2), the
  mutation-proving red case (3.3), cross-instance exclusivity (3.4).
- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunEndToEndSpec.scala`
  (new) — write-time wiring, owner-attribution (3.6), guard-rejection-not-dropped (3.7), real
  measured write-to-run latency (3.9).

## Docs

- `CLAUDE.md` (worktree root) — documented `DATASET_WRITE_DEBOUNCE_SECONDS` in the production env
  var table.

## OpenSpec

- `openspec/changes/auto-run-trigger-debounced/tasks.md` — all tasks marked complete.
- `openspec/changes/auto-run-trigger-debounced/files-modified.md` — this file.
