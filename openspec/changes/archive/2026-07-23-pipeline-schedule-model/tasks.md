## 1. ### Backend — Schema

- [x] 1.1 Add `V62__pipeline_schedules.sql`: `pipeline_schedules` table (`id`, `pipeline_id` FK
      UNIQUE to `pipelines(id) ON DELETE CASCADE`, `kind`, `expression`, `enabled`, `timezone`,
      `next_run_at`, `last_run_at`, `created_at`, `updated_at`)
- [x] 1.2 Add indirect-owner RLS (`ENABLE`/`FORCE ROW LEVEL SECURITY` + `pipeline_schedules_owner`
      EXISTS-subquery policy against `pipelines.owner_id`), mirroring `pipeline_steps_owner`

## 2. ### Backend — Domain + Repository

- [x] 2.1 Add `PipelineScheduleId` and `PipelineSchedule` domain model to `model.scala`
      (`id`, `pipelineId`, `kind`, `expression`, `enabled`, `timezone`, `nextRunAt`, `lastRunAt`,
      `createdAt`, `updatedAt`); add a `ScheduleKind` enum (`Cron`/`Interval`) mirroring `Severity`
- [x] 2.2 Add `PipelineScheduleRepository` (`findByPipelineId`, `upsert`, `delete`, all
      owner-scoped via `withUserContext`), mirroring `AlertRuleRepository`'s shape

## 3. ### Backend — Service + Validation

- [x] 3.1 Add `PipelineScheduleService` with `find`/`put`/`delete`, ACL-gated against
      `pipelineRepo.findByIdOwned` (mirrors `AlertRuleService.create`'s target-ownership check)
- [x] 3.2 Add cron structural validator (5-field, per-field range/wildcard/list/step syntax) and
      interval validator (`<n><unit>`, `n > 0`) per design.md Decision 5
- [x] 3.3 Add timezone validation via `java.time.ZoneId.of(_)`
- [x] 3.4 Normalize absent `enabled` to `true` on create/replace

## 4. ### Backend — API

- [x] 4.1 Add `PipelineScheduleResponse`/`PutPipelineScheduleRequest` to a new
      `PipelineScheduleProtocol.scala`, wired into `JsonProtocols`
- [x] 4.2 Add `PipelineScheduleRoutes` exposing `GET/PUT/DELETE` under the existing
      `PipelineIdSegment / "schedule"` path, mirroring `PipelineRoutes`'s nested-path shape
- [x] 4.3 Wire `PipelineScheduleRepository`/`Service`/`Routes` into `ApiRoutes.scala` and
      `Main.scala`, following the optional-repo pattern used for `alertRuleRepo`

## 5. ### Contracts

- [x] 5.1 Add `schemas/pipeline-schedule.schema.json` and
      `schemas/put-pipeline-schedule-request.schema.json`
- [x] 5.2 Update `CLAUDE.md`'s Key Endpoints list with the new routes (per repo convention)

## 6. ### Tests

- [x] 6.1 `PipelineScheduleRepositorySpec`: CRUD, owner-scoping/RLS, cascade-delete-on-pipeline
- [x] 6.2 `PipelineScheduleServiceSpec`: cron/interval/timezone validation (valid + invalid cases),
      enabled-default-normalization, not-found/not-owned ACL cases
- [x] 6.3 `PipelineScheduleRoutesSpec` (or `ApiRoutesSpec` addition): GET/PUT/DELETE happy paths,
      404s for unknown/non-owned pipeline, 400s for invalid expressions
