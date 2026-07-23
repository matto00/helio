# Files modified — pipeline-schedule-model (HEL-414)

- `backend/src/main/resources/db/migration/V62__pipeline_schedules.sql` — new migration: `pipeline_schedules` table (`pipeline_id` UNIQUE FK to `pipelines(id) ON DELETE CASCADE`), indirect-owner RLS (`ENABLE`/`FORCE ROW LEVEL SECURITY` + `pipeline_schedules_owner` EXISTS-subquery policy against `pipelines.owner_id`, mirroring V35's `pipeline_steps_owner`).
- `backend/src/main/scala/com/helio/domain/model.scala` — added `PipelineScheduleId`, `ScheduleKind` (Cron/Interval, mirrors `Severity`), and the `PipelineSchedule` domain case class.
- `backend/src/main/scala/com/helio/infrastructure/PipelineScheduleRepository.scala` — new owner-scoped (via parent pipeline) Slick repository: `findByPipelineId` (JOIN to `pipelines.owner_id`), `upsert` (keyed by PK `id`, reused by the service for create-or-replace), `delete` (keyed by `pipeline_id`).
- `backend/src/main/scala/com/helio/services/PipelineScheduleService.scala` — new service: `find`/`put`/`delete`, ACL-gated against `pipelineRepo.findByIdOwned`; hand-rolled structural cron (5-field, range/wildcard/list/step) and interval (`<n><unit>`) validators; timezone validation via `java.time.ZoneId.of(_)`; normalizes absent `enabled` to `true`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineScheduleProtocol.scala` — new protocol: `PipelineScheduleResponse`, `PutPipelineScheduleRequest`, spray-json formats.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `PipelineScheduleProtocol`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exported `PipelineScheduleResponse`/`PutPipelineScheduleRequest` into `com.helio.api`.
- `backend/src/main/scala/com/helio/api/routes/PipelineScheduleRoutes.scala` — new thin HTTP shell for `GET/PUT/DELETE /api/pipelines/:id/schedule`, nested under the existing `PipelineIdSegment` path matcher.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wired `PipelineScheduleRepository`/`PipelineScheduleService`/`PipelineScheduleRoutes` in following the nullable-optional-repo pattern used for `alertRuleRepo`/`alertEventRepo`.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `PipelineScheduleRepository` and passes it into `ApiRoutes` for production wiring.
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added `pipeline_schedules` to the `rlsTables` allowlist (required alongside the V62 migration per CONTRIBUTING.md's "Adding a new ACL'd table" checklist).
- `backend/src/test/scala/com/helio/infrastructure/PipelineScheduleRepositorySpec.scala` — new: CRUD round-trip, owner-scoping/RLS exclusion, upsert-replace-is-single-row, cascade-delete-on-pipeline.
- `backend/src/test/scala/com/helio/services/PipelineScheduleServiceSpec.scala` — new: cron/interval/timezone validation (valid + invalid cases incl. field-count/out-of-range/non-numeric/list-range-step), `enabled` default normalization, not-found/not-owned ACL cases for find/put/delete.
- `backend/src/test/scala/com/helio/api/routes/PipelineScheduleRoutesSpec.scala` — new: GET/PUT/DELETE happy paths, upsert-replace via HTTP, 400s for invalid cron/interval/timezone, 404s for unknown/non-owned pipeline.
- `schemas/pipeline-schedule.schema.json` — new: `PipelineScheduleResponse` wire shape.
- `schemas/put-pipeline-schedule-request.schema.json` — new: `PutPipelineScheduleRequest` wire shape.
- `CLAUDE.md` — added the new `/api/pipelines/:id/schedule` endpoint to the Key Endpoints list.
- `openspec/changes/pipeline-schedule-model/tasks.md` — all 16 tasks marked complete.
