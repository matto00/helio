# HEL-447: Alert rule model + persistence (AlertRule domain, repo, CRUD API)

## Context

There is no alerting in Helio today — this is greenfield. Alerting evaluates the data produced by pipeline runs: a run completes in `PipelineRunService.onRunSuccess` (`backend/src/main/scala/com/helio/services/PipelineRunService.scala`), which upserts the output DataType's rows via `DataTypeRowRepository` and its schema via `DataTypeRepository`. The row snapshot a rule reads is the same one served by `GET /api/types/:id/rows` (`DataTypeRoutes.scala` → `DataTypeService.listRows`).

This ticket is the persistence foundation for the whole alerting subsystem: a durable model of alert rules. It does not evaluate anything (that is the engine ticket) — it only stores and serves rule definitions.

## Scope

* New domain model in `backend/src/main/scala/com/helio/domain/`: `AlertRule` case class + value-class `AlertRuleId(value: String) extends AnyVal` (follow the `DataTypeId`/`PipelineId` pattern in `model.scala`), with `ResourceMeta` for timestamps and an `ownerId: UserId`.
* Rule fields: `targetDataTypeId: DataTypeId`, `metric` (field name in the DataType rows, or a reserved `*`/count sentinel), `condition` stored as a flexible `jsonb` column (comparator + threshold + window params) so richer condition kinds can be added without a migration, `name`, `enabled: Boolean`, and a `severity` string enum (`info`/`warning`/`critical`).
* Flyway migration (next available VNN, assigned at scheduling time; main is at V59 — verify actual next number in `backend/src/main/resources/db/migration/` at scheduling time): `alert_rules` table, owner FK, RLS policy consistent with the existing owner-scoped tables (see V35-style policies referenced across the repo), `condition` as `jsonb`.
* Repository in `backend/src/main/scala/com/helio/infrastructure/` (Slick), owner-scoped `findAll`/`findById`/`insert`/`update`/`delete`, plus a privileged `listEnabledByDataTypeInternal(dataTypeId)` (system-context, RLS-bypassing) the evaluation engine will call in a background post-run path with no request user — mirror the `*Internal` pattern already used in `PipelineRunService`.
* Service layer `AlertRuleService` (mirror `DataTypeService`) returning `Either[ServiceError, _]`.
* Wire types + comparator/severity enums; no inline fully-qualified names in Scala (see CONTRIBUTING.md).
* REST routes `/api/alert-rules` (GET list, POST create, GET/PATCH/DELETE `:id`) as a thin `AlertRuleRoutes` shell composed into `ApiRoutes.scala` next to `DataTypeRoutes`; normalize inputs via `RequestValidation`.
* `JsonProtocols.scala` spray-json formatters for all request/response types.
* Schema/spec: add rule request/response shapes to `schemas/` (JSON Schema 2020-12) and `openspec/`.

## Acceptance criteria

* Rule shape: `{ targetDataTypeId, metric, condition: { comparator: gt|gte|lt|lte|eq|neq, threshold: number, window? }, severity, enabled, name }` round-trips through create → fetch unchanged; spray-json omits `None` options on the wire, so the service normalizes absent optional fields at the boundary (test with fields absent — see the pipeline-only-bindings precedent).
* CRUD is owner-scoped: a second user cannot read or mutate another user's rule (403/404), enforced by both service checks and RLS.
* Creating a rule against a non-existent or non-owned `targetDataTypeId` returns 422/404.
* `condition` persists as jsonb and unknown/extra keys survive a round-trip (forward-compat for condition-types ticket).
* ScalaTest: repository CRUD + RLS scoping, service validation, route-level happy path + auth failure. Backend `sbt test` green.

## Out of scope

* Any evaluation of rules (engine ticket).
* Alert event/state persistence (event-model ticket).
* Frontend UI (Alert Management UI epic).

## Dependencies

* None (foundational). The evaluation engine, event model, delivery, and UI all build on this.

## Batch context (informational — not part of this ticket's scope)

This is ticket 1 of a strictly sequential 3-ticket alerts chain: HEL-447 → HEL-455 → HEL-466. The next tickets FK this ticket's table and take the next Flyway VNN after this one merges. Delivery for this ticket uses GitHub CI as the merge gate (auto-merge on green) rather than pausing for human PR review, per orchestrator instruction — local verification gates still run before push.

**Flyway version note:** ticket text says main is at V59; verify the actual next available VNN in `backend/src/main/resources/db/migration/` at scheduling time (confirmed V60 as of this run).
