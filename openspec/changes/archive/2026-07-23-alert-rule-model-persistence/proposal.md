## Why

Helio has no alerting today. The alerting subsystem needs a durable model of alert rules before
anything can evaluate them, persist events, or notify. This change lays that persistence
foundation only: domain model, migration, repository, service, and CRUD API. It is the first of a
three-ticket sequential chain (HEL-447 → HEL-455 → HEL-466); later tickets FK this table.

## What Changes

- New `AlertRule` domain model (`AlertRuleId` value class, `targetDataTypeId`, `metric`,
  `condition` (jsonb-backed comparator/threshold/window), `name`, `enabled`, `severity`,
  `ownerId`, timestamps).
- Flyway migration creating `alert_rules` (owner FK, RLS policy consistent with other
  owner-scoped tables, `condition` as `jsonb`). Next available version confirmed at scheduling
  time (V60 in this worktree).
- `AlertRuleRepository` (Slick): owner-scoped `findAll`/`findById`/`insert`/`update`/`delete`,
  plus a privileged `listEnabledByDataTypeInternal(dataTypeId)` mirroring the `*Internal`
  RLS-bypassing pattern already used for background/system-context reads.
- `AlertRuleService` (mirrors `DataTypeService`), returning `Either[ServiceError, _]`, validating
  `targetDataTypeId` exists and is owned by the caller.
- Wire types + comparator/severity enums, `JsonProtocols.scala` formatters, `RequestValidation`
  normalization of optional fields (spray-json omits `None` on the wire).
- `AlertRuleRoutes` (`/api/alert-rules`: GET list, POST create, GET/PATCH/DELETE `:id`) composed
  into `ApiRoutes.scala`.
- JSON Schema (`schemas/`) and OpenAPI (`openspec/specs/`) additions for the rule shapes.

## Capabilities

### New Capabilities

- `alert-rule-persistence`: durable storage of alert rule definitions — domain model, Flyway
  schema, owner-scoped + privileged repository access patterns.
- `alert-rule-crud-api`: REST CRUD surface for alert rules, request/response contracts,
  validation and ownership-scoping behavior (mirrors `datatype-crud-api`).

### Modified Capabilities

(none — greenfield; no existing capability's requirements change)

## Impact

- Affected code: `backend/src/main/scala/com/helio/domain/model.scala` (or a new file for
  `AlertRule`), new `backend/src/main/scala/com/helio/infrastructure/AlertRuleRepository.scala`,
  new `backend/src/main/scala/com/helio/services/AlertRuleService.scala`, new
  `backend/src/main/scala/com/helio/api/AlertRuleRoutes.scala`, `ApiRoutes.scala`,
  `JsonProtocols.scala`, a new Flyway migration, `schemas/`, `openspec/`.
- No frontend impact (out of scope).
- Downstream: HEL-455 (evaluation engine) and HEL-466 (event model) depend on this table and the
  `listEnabledByDataTypeInternal` repository method.

## Non-goals

- Evaluating rules against data (engine ticket, HEL-455).
- Alert event/state persistence (event-model ticket, HEL-466).
- Any frontend UI.
