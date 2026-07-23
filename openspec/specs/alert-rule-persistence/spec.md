# alert-rule-persistence Specification

## Purpose
Durable, owner-scoped storage of alert rule definitions — the AlertRule domain model, Flyway
schema, and repository access patterns (owner-scoped and privileged) that the alert evaluation
engine, event model, and delivery pipeline build on.
## Requirements
### Requirement: AlertRule domain model and schema
The system SHALL define an `AlertRule` domain model with `id: AlertRuleId`, `ownerId: UserId`,
`targetDataTypeId: DataTypeId`, `metric: String`, `condition: JsValue`, `name: String`,
`enabled: Boolean`, `severity` (one of `info`/`warning`/`critical`), `createdAt`, and `updatedAt`.
A Flyway migration SHALL create an `alert_rules` table with a `condition` column of type `jsonb`
and an owner FK to `users(id)`.

#### Scenario: Migration creates the table
- **WHEN** Flyway applies the alert-rules migration to a fresh database
- **THEN** an `alert_rules` table exists with columns for owner, target data type, metric,
  jsonb condition, name, enabled, severity, created_at, and updated_at

#### Scenario: condition persists arbitrary jsonb
- **WHEN** a rule is inserted with `condition = { "comparator": "gt", "threshold": 5, "window": "1h" }`
- **THEN** the stored `condition` value round-trips unchanged, including unknown/extra keys added
  by future condition kinds

### Requirement: RLS owner scoping on alert_rules
The `alert_rules` table SHALL have `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` enabled,
with a single `alert_rules_owner` USING policy restricting access to rows whose `owner_id` matches
`current_setting('app.current_user_id')::uuid`, consistent with the direct-owner pattern used for
`pipelines` and `data_types`.

#### Scenario: Owner can read their own rule
- **WHEN** a query runs inside `withUserContext(ownerId)` for a rule owned by `ownerId`
- **THEN** the rule is returned

#### Scenario: Non-owner cannot read another user's rule
- **WHEN** a query runs inside `withUserContext(otherUserId)` for a rule owned by a different user
- **THEN** the rule is not returned (empty result, not an error)

### Requirement: Owner-scoped repository CRUD
`AlertRuleRepository` SHALL expose owner-scoped `findAll(ownerId)`, `findById(ownerId, id)`,
`insert`, `update`, and `delete` operations that run through `withUserContext` and are subject to
RLS.

#### Scenario: findById excludes non-owned rows
- **WHEN** `findById(userA, ruleOwnedByUserB)` is called
- **THEN** the result is empty/not found, not the other user's rule

### Requirement: Privileged internal read for the evaluation engine
`AlertRuleRepository` SHALL expose `listEnabledByDataTypeInternal(dataTypeId: DataTypeId)` running
through `withSystemContext` (RLS bypass), returning all enabled rules targeting the given
DataType regardless of owner, for use by a background/system-context caller with no request user.

#### Scenario: Returns enabled rules across owners
- **WHEN** `listEnabledByDataTypeInternal(dataTypeId)` is called and enabled rules targeting that
  DataType exist for multiple different owners
- **THEN** all of them are returned, bypassing per-owner RLS restriction

#### Scenario: Excludes disabled rules
- **WHEN** a rule targeting the DataType exists but `enabled = false`
- **THEN** it is excluded from the result

