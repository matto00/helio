## ADDED Requirements

### Requirement: MetricDefinition domain model
The system SHALL provide a `MetricDefinition` domain model with a `MetricId` value
class, binding to a pipeline-output `DataType` via `dataTypeId`, and carrying
`ownerId`, `name`, `description`, `measureField`, `aggregation`, `allowedDimensions`,
a `format` (`MetricFormat`: `unit`/`decimals`/`prefix`/`suffix`, all optional),
`deprecated` (default `false`), `createdAt`, `updatedAt`.

#### Scenario: Construct a valid MetricDefinition
- **WHEN** a `MetricDefinition` is constructed with `aggregation = "sum"` and a
  non-empty `measureField`
- **THEN** the value is held as-is; no exception is thrown at construction

### Requirement: Aggregation allow-list validation
The system SHALL validate `aggregation` against the allow-list
`sum|avg|min|max|count|countDistinct` at the domain boundary, rejecting any other
value with a descriptive error rather than persisting it.

#### Scenario: Unknown aggregation value rejected
- **WHEN** a caller attempts to persist a `MetricDefinition` with
  `aggregation = "median"`
- **THEN** the operation returns a `Left` with a descriptive error naming the
  invalid value and the valid allow-list, and no row is written

#### Scenario: Allow-listed aggregation value accepted
- **WHEN** a caller persists a `MetricDefinition` with `aggregation = "countDistinct"`
- **THEN** the operation succeeds and the row is written with that aggregation value

### Requirement: metrics table with owner-only RLS
The system SHALL persist `MetricDefinition` rows in a `metrics` table created by a
Flyway migration, with Row Level Security enabled and forced, a single owner
policy comparing `owner_id` to `current_setting('app.current_user_id')::uuid`, an
`owner_id UUID NOT NULL REFERENCES users(id)` column, a `data_type_id` foreign key
referencing `data_types(id) ON DELETE CASCADE`, and indexes on both `owner_id` and
`data_type_id`. `allowed_dimensions` and `format` SHALL be stored as JSONB.

#### Scenario: RLS isolates metrics between owners
- **WHEN** owner A inserts a metric and owner B queries metrics under owner B's
  RLS user context
- **THEN** owner B's query does not return owner A's metric

#### Scenario: Deleting the bound DataType cascades to its metrics
- **WHEN** the `DataType` a `MetricDefinition` is bound to (via `data_type_id`) is
  deleted
- **THEN** the dependent `metrics` row is also deleted (CASCADE), with no orphaned
  row remaining

### Requirement: MetricRepository CRUD surface
The system SHALL provide a `MetricRepository` (Slick) with owner-scoped `insert`,
`findByIdOwned`, `listByOwner`, `update`, and `delete` methods running under
`withUserContext`, mirroring `DataTypeRepository`/`PipelineRepository` conventions.

#### Scenario: Round-trip through the repository
- **WHEN** a `MetricDefinition` is inserted via `MetricRepository.insert` under an
  owner's user context, then read back via `findByIdOwned`, `listByOwner`,
  `update`, and finally `delete`
- **THEN** each operation succeeds and reflects the expected state (insert returns
  the persisted row; findByIdOwned/listByOwner return it; update persists the
  changed fields; delete removes it and a subsequent findByIdOwned returns `None`)

### Requirement: MetricDefinition JSON formatters
The system SHALL provide spray-json `RootJsonFormat` instances for `MetricFormat`
(used directly by the JSONB column encoding) and for a `MetricResponse` wire DTO
(with a `fromDomain` conversion from `MetricDefinition`) in `MetricProtocol.scala`,
mixed into `JsonProtocols.scala`'s aggregator trait, mirroring the
`AlertRuleResponse`/`AlertRuleProtocol` convention used for every other
ID/Instant-bearing domain entity in this codebase. No fully-qualified names SHALL
be inlined at any call site.

#### Scenario: MetricResponse round-trips through JSON
- **WHEN** a `MetricDefinition` is converted to a `MetricResponse` via
  `fromDomain`, serialized to JSON, and then deserialized back
- **THEN** the resulting `MetricResponse` equals the original
