## 1. Backend: Domain model

- [x] 1.1 Add `MetricId(value: String) extends AnyVal` to `model.scala`, alongside
      the other value-class IDs.
- [x] 1.2 Add `MetricFormat` case class (`unit`, `decimals`, `prefix`, `suffix`, all
      `Option`) to `model.scala`.
- [x] 1.3 Add `MetricDefinition` case class to `model.scala` with the fields listed
      in the ticket (`id`, `ownerId`, `dataTypeId`, `name`, `description`,
      `measureField`, `aggregation`, `allowedDimensions`, `format`,
      `deprecated = false`, `createdAt`, `updatedAt`).
- [x] 1.4 Add a `MetricAggregation` companion object with the allow-list
      (`sum|avg|min|max|count|countDistinct`) and a `fromString`/`validate`
      function returning `Either[String, String]`, mirroring `Severity`/
      `Comparator`/`ScheduleKind`'s pattern in the same file. NOTE: this is a
      deliberate deviation from the `sealed trait` ADT shape those three use —
      `MetricDefinition.aggregation` stays a raw `String` per the ticket's
      literal field list, validated only at the repository insert/update
      boundary, not at construction (design.md Decision 1). Do not "fix" this
      into a full ADT.

## 2. Backend: Persistence

- [x] 2.1 Determine the next available Flyway version by listing
      `backend/src/main/resources/db/migration/` (do not hardcode from the
      ticket — main has moved since the ticket was written). (V75, main was at V74)
- [x] 2.2 Add `VNN__metrics.sql`: `CREATE TABLE metrics` with `id TEXT PRIMARY KEY`,
      `owner_id UUID NOT NULL REFERENCES users(id)` (per the `V60__alert_rules.sql`/
      `V61__alert_events.sql` precedent — newer than V35/V54, add the FK),
      `data_type_id TEXT NOT NULL REFERENCES data_types(id) ON DELETE CASCADE`,
      `name TEXT NOT NULL`, `description TEXT`, `measure_field TEXT NOT NULL`,
      `aggregation TEXT NOT NULL`, `allowed_dimensions JSONB NOT NULL`,
      `format JSONB NOT NULL`, `deprecated BOOLEAN NOT NULL DEFAULT false`,
      `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`.
- [x] 2.3 Add `idx_metrics_owner_id` index on `owner_id` AND `idx_metrics_data_type_id`
      index on `data_type_id` (the latter mirrors `idx_alert_rules_target_data_type_id`
      in `V60__alert_rules.sql` — needed since `data_type_id` carries
      `ON DELETE CASCADE` and would otherwise force an unindexed scan on every
      `DataType` delete).
- [x] 2.4 Add RLS: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` +
      single `metrics_owner` policy `USING (owner_id =
      current_setting('app.current_user_id')::uuid)`, following V35/V54.
      (Also added `metrics` to `RlsPolicyGuardSpec.rlsTables` per
      CONTRIBUTING.md's "Adding a new ACL'd table" checklist.)

## 3. Backend: Repository

- [x] 3.1 Add `backend/src/main/scala/com/helio/infrastructure/MetricRepository.scala`
      mirroring `DataTypeRepository`'s structure: `MetricRow`/`MetricTable`,
      `rowToDomain`/`domainToRow`, JSONB `MappedColumnType` for
      `Vector[String]` (`allowedDimensions`) and `MetricFormat`.
- [x] 3.2 Implement `insert(m: MetricDefinition, user: AuthenticatedUser):
      Future[Either[String, MetricDefinition]]` — validates `aggregation` via
      `MetricAggregation` before writing under `withUserContext`.
- [x] 3.3 Implement `findByIdOwned(id: MetricId, user: AuthenticatedUser):
      Future[Option[MetricDefinition]]` under `withUserContext`.
- [x] 3.4 Implement `listByOwner(user: AuthenticatedUser):
      Future[Vector[MetricDefinition]]` under `withUserContext`.
- [x] 3.5 Implement `update(m: MetricDefinition, user: AuthenticatedUser):
      Future[Either[String, Option[MetricDefinition]]]` — validates
      `aggregation`, updates `updatedAt`, under `withUserContext`.
- [x] 3.6 Implement `delete(id: MetricId, user: AuthenticatedUser):
      Future[Boolean]` under `withUserContext`.
- [x] 3.7 Implement `findByIdInternal(id: MetricId): Future[Option[MetricDefinition]]`
      under `withSystemContext`, mirroring `DataTypeRepository.findByIdInternal`.

## 4. Backend: JSON

- [x] 4.1 Add `backend/src/main/scala/com/helio/api/protocols/MetricProtocol.scala`
      following the `AlertRuleProtocol.scala` pattern: a `RootJsonFormat[MetricFormat]`
      (needed directly, for the JSONB `format` column's `MappedColumnType` in
      `MetricRepository`) plus a `MetricResponse` wire DTO (string-ified
      `id`/`ownerId`/`dataTypeId`, string-ified `createdAt`/`updatedAt`, an
      embedded `MetricFormat`) with a `fromDomain` conversion and its own
      `RootJsonFormat[MetricResponse]` — mirroring `AlertRuleResponse`/
      `AlertRuleResponse.fromDomain`. No top-level `RootJsonFormat[MetricDefinition]`
      is added directly on the domain case class: every existing ID/Instant-bearing
      entity in this codebase (`AlertRule`, `DataType`, `PipelineSchedule`, etc.)
      is exposed via a `*Response` DTO instead, and no `JsonFormat[Instant]`
      instance exists anywhere to support direct macro-derivation on the domain
      type. Mix `MetricProtocol` into `JsonProtocols.scala`'s aggregator trait.

## 5. Tests

- [x] 5.1 Add a ScalaTest repository spec
      (`backend/src/test/scala/com/helio/infrastructure/MetricRepositorySpec.scala`)
      covering insert/findByIdOwned/listByOwner/update/delete round-trip under a
      user RLS context.
- [x] 5.2 Add a test proving RLS isolation: owner A's metric is not visible to
      owner B's `findByIdOwned`/`listByOwner` under owner B's context. NOTE:
      per `AlertRuleRepositorySpec`'s own documented limitation, dev/CI connects
      as Postgres superuser on both pools (unconditionally bypasses `FORCE ROW
      LEVEL SECURITY`), so this test only proves app-layer `WHERE owner_id = ?`
      scoping, not real Postgres RLS enforcement — match the existing pattern,
      do not overclaim in the test's description/comments.
- [x] 5.3 Add a test proving CASCADE delete: deleting the bound `DataType` removes
      the dependent `metrics` row.
- [x] 5.4 Add a domain-level test proving an unknown `aggregation` value is
      rejected with a descriptive `Left` and no row is written.
- [x] 5.5 Add a JSON round-trip test for `MetricResponse` (via `fromDomain`) and
      `MetricFormat`.
- [x] 5.6 Run `sbt test` and confirm the full suite passes (no existing test
      regressions).
