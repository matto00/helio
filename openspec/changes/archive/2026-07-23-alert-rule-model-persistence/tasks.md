## 1. ### Backend — Domain model

- [x] 1.1 Add `AlertRuleId(value: String) extends AnyVal` value class to `model.scala` (or a new
      file if `model.scala` conventions favor per-feature files — confirm at implementation time).
- [x] 1.2 Add `Severity` sealed trait (`Info`/`Warning`/`Critical`) with `fromString`/`asString`,
      mirroring the `Role` enum pattern.
- [x] 1.3 Add `AlertRule` case class: `id`, `ownerId: UserId`, `targetDataTypeId: DataTypeId`,
      `metric: String`, `condition: JsValue`, `name: String`, `enabled: Boolean`,
      `severity: Severity`, `createdAt: Instant`, `updatedAt: Instant`.

## 2. ### Backend — Migration

- [x] 2.1 Re-verify the next available Flyway version by listing
      `backend/src/main/resources/db/migration/` (confirmed V60 as of scheduling; re-check for
      drift before writing the file).
- [x] 2.2 Write `V<NN>__alert_rules.sql`: create `alert_rules` table (owner FK to `users(id)`,
      `target_data_type_id` FK to `data_types(id)` `ON DELETE CASCADE`, `condition jsonb`,
      `severity text`, `enabled boolean`, `name text`, `created_at`/`updated_at`).
- [x] 2.3 Enable `ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on `alert_rules`, add
      `alert_rules_owner` USING policy on `owner_id = current_setting('app.current_user_id')::uuid`,
      matching the V35 direct-owner pattern.

## 3. ### Backend — Repository

- [x] 3.1 Create `AlertRuleRepository` in `infrastructure/`: owner-scoped `findAll(ownerId)`,
      `findById(ownerId, id)`, `insert`, `update`, `delete`, all via `withUserContext`.
- [x] 3.2 Grep for existing jsonb Slick column handling (`DataTypeRowRepository`,
      `DataSourceRepository`, `PanelRepository` per V33/V43) and reuse that pattern for the
      `condition` column so it maps to `JsValue` opaquely (unknown keys survive).
- [x] 3.3 Add privileged `listEnabledByDataTypeInternal(dataTypeId)` via `withSystemContext`, with
      an inline justification comment per the `rls-privileged-bypass` convention (no caller yet —
      reserved for HEL-455's background evaluation path).

## 4. ### Backend — Service

- [x] 4.1 Create `AlertRuleService` (mirror `DataTypeService` shape) returning
      `Either[ServiceError, _]` for list/get/create/update/delete.
- [x] 4.2 On create, validate `targetDataTypeId` exists and is owned by the caller (via
      `dataTypeRepo.findById`, not `*Internal`) — non-existent/non-owned → `NotFound`/`Forbidden`.
- [x] 4.3 Normalize optional fields absent from the wire (spray-json omits `None`) at the service
      boundary — test explicitly with fields absent per the pipeline-only-bindings precedent.
- [x] 4.4 Validate `condition` on write contains well-formed `comparator`/`threshold` keys of the
      expected shape; pass the rest of the jsonb blob through opaquely.

## 5. ### Backend — Wire types, JSON, routes

- [x] 5.1 Add `Comparator` sealed trait (`Gt`/`Gte`/`Lt`/`Lte`/`Eq`/`Neq`) with
      `fromString`/`asString` for use inside the `condition` payload validation.
- [x] 5.2 Add request/response wire case classes for alert rules (create/update/response shapes)
      without inline fully-qualified names.
- [x] 5.3 Add `JsonProtocols.scala` spray-json formatters for all new wire types.
- [x] 5.4 Add `RequestValidation` normalization entries for the new request types (as needed).
- [x] 5.5 Create `AlertRuleRoutes` (`GET /api/alert-rules`, `POST /api/alert-rules`,
      `GET/PATCH/DELETE /api/alert-rules/:id`), thin shell mirroring `DataTypeRoutes`.
- [x] 5.6 Compose `AlertRuleRoutes` into `ApiRoutes.scala` next to `DataTypeRoutes`.

## 6. ### Backend — Schema/spec artifacts

- [x] 6.1 Add alert-rule request/response JSON Schema (2020-12) definitions under `schemas/`.
- [x] 6.2 Add alert-rule endpoints to the OpenAPI spec under `openspec/`.

## 7. ### Tests

- [x] 7.1 `AlertRuleRepository` ScalaTest: CRUD round-trip, RLS scoping (owner vs. non-owner),
      `listEnabledByDataTypeInternal` bypasses per-owner RLS and excludes disabled rules.
- [x] 7.2 `AlertRuleService` ScalaTest: validation of non-existent/non-owned `targetDataTypeId`,
      optional-field normalization with fields absent, `condition` round-trip with unknown/extra
      keys preserved.
- [x] 7.3 `AlertRuleRoutes` ScalaTest: happy-path CRUD, auth/ownership failure (403/404) for a
      second user's rule, 404/422 for a non-existent/non-owned target DataType on create.
- [x] 7.4 Run `sbt test` and confirm the full backend suite is green.
