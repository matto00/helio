# audit-event-persistence Specification

## Purpose
Durable, append-only, owner-scoped storage of security audit events — the `audit_events` Flyway
schema, its immutability guarantee, its RLS owner-scoped read policy, and the repository access
patterns the recording path and the later audit-query ticket build on.

## ADDED Requirements

### Requirement: audit_events schema and migration
The system SHALL provide a Flyway migration creating an `audit_events` table with columns for
`id` (UUID primary key, default `gen_random_uuid()`), `actor_user_id` (UUID, nullable, for
pre-auth and system events), `actor_token_id` (UUID, nullable, soft reference to `api_tokens`),
`source` (text, `CHECK` constrained to `ui`/`pat`/`mcp`/`system`), `action` (text, NOT NULL),
`resource_type` (text, NOT NULL), `resource_id` (text, nullable), `metadata` (jsonb NOT NULL DEFAULT `'{}'::jsonb`), and
`created_at` (timestamptz NOT NULL default `now()`), plus indexes on `(actor_user_id, created_at)`
and `(resource_type, resource_id)`.

The migration SHALL be numbered at the next available version above the current maximum on the
base branch, verified immediately before authoring.

#### Scenario: Migration creates the table
- **WHEN** Flyway applies the audit-events migration to a database
- **THEN** an `audit_events` table exists with the specified columns, the `source` CHECK
  constraint, and both specified indexes

#### Scenario: Source values outside the enum are rejected
- **WHEN** a row is inserted with a `source` value other than `ui`, `pat`, `mcp`, or `system`
- **THEN** the insert fails with a check-constraint violation

#### Scenario: Deleting the referenced token does not erase history
- **WHEN** an `api_tokens` row referenced by `audit_events.actor_token_id` is deleted
- **THEN** the audit rows survive, and their `actor_token_id` does not cascade-delete the audit row

### Requirement: audit_events is append-only and fails loudly
The `audit_events` table SHALL reject every UPDATE, every DELETE, and every TRUNCATE with a raised
database error. A silent zero-row result SHALL NOT be considered satisfying this requirement.

Enforcement SHALL be implemented so that it cannot be undone by re-granting table privileges and
is not bypassed by a `BYPASSRLS` role. Consequently the guarantee SHALL hold on the app pool
(`DbContext.withUserContext`) and on the privileged pool (`DbContext.withSystemContext`,
`helio_privileged`) alike.

#### Scenario: UPDATE against an existing audit row fails
- **GIVEN** an `audit_events` row exists
- **WHEN** any connection issues an UPDATE against `audit_events`
- **THEN** the statement raises a database error, and the row is unchanged

#### Scenario: DELETE against an existing audit row fails
- **GIVEN** an `audit_events` row exists
- **WHEN** any connection issues a DELETE against `audit_events`
- **THEN** the statement raises a database error, and the row still exists

#### Scenario: UPDATE or DELETE of a row invisible to the app-pool caller still fails loudly
- **GIVEN** a NULL-actor audit row, and a second row whose `actor_user_id` is some other user
- **WHEN** an app-pool connection whose `app.current_user_id` matches neither row issues a TARGETED
  UPDATE or DELETE against them (one carrying a `WHERE id = ...` clause, not a bare table-wide statement —
  a column-free statement is the single form that escapes RLS scan-filtering, so a scenario satisfiable by
  it alone would prove nothing)
- **THEN** the statement raises a database error
- **AND** it does NOT report zero rows affected and succeed
- **AND** therefore the append-only guarantee must not depend on a row being visible to the scan: it is
  carried by a statement-level `BEFORE` trigger that fires before the scan, not by a row-level trigger
  that fires only for rows RLS has already made visible

#### Scenario: TRUNCATE against the audit table fails
- **GIVEN** an `audit_events` row exists
- **WHEN** a connection holding TRUNCATE privilege on the table — including the table owner, which the
  application's app pool connects as — issues `TRUNCATE audit_events`
- **THEN** the statement raises a database error, and the row still exists

#### Scenario: The privileged BYPASSRLS pool is equally unable to mutate
- **GIVEN** an `audit_events` row exists
- **WHEN** a connection holding the `helio_privileged` role issues an UPDATE or DELETE
- **THEN** the statement raises a database error

#### Scenario: Re-granting privileges does not restore mutability
- **GIVEN** `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` has been issued
  to the app role after the migration ran
- **WHEN** that role issues an UPDATE or DELETE against `audit_events`
- **THEN** the statement still raises a database error

#### Scenario: INSERT succeeds on the privileged pool the write path uses
- **WHEN** a connection on the privileged pool (`DbContext.withSystemContext`, the pool
  `AuditEventRepository.append` runs on) inserts a well-formed audit row
- **THEN** the insert succeeds
- **AND** the privileged role's INSERT privilege on this table is confirmed present rather than assumed,
  since it is inherited solely from the `ALTER DEFAULT PRIVILEGES` grant

### Requirement: RLS owner scoping on audit_events
The `audit_events` table SHALL have `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` enabled,
with an owner-scoped policy **restricted to `FOR SELECT`** restricting app-pool read visibility to
rows whose `actor_user_id` matches `current_setting('app.current_user_id')::uuid`, following the
direct-owner predicate of `V35` and `V42`.

The policy SHALL NOT be an unscoped (`FOR ALL`) policy: under `FORCE ROW LEVEL SECURITY` an unscoped
policy's `USING` qual is applied to UPDATE and DELETE during the scan, filtering non-owned and
NULL-actor rows out before the append-only trigger can fire and producing the forbidden silent
zero-row result. Permissive `FOR UPDATE` and `FOR DELETE` policies SHALL exist as defence-in-depth, but SHALL NOT be
relied upon as the mechanism: Postgres applies `SELECT` policies alongside them whenever a statement
references table columns, so targeted statements remain scan-filtered. The guarantee is carried by the
statement-level trigger.

Because no policy then applies to INSERT, app-pool INSERT is denied outright under `FORCE ROW LEVEL
SECURITY`. This is accepted: every insert runs on the privileged pool.

Cross-user and administrator-wide reads are out of scope.

#### Scenario: A user reads only their own audit rows
- **GIVEN** audit rows exist for two distinct `actor_user_id` values
- **WHEN** the app pool queries `audit_events` with `app.current_user_id` set to the first user
- **THEN** only that user's rows are returned

#### Scenario: System-authored rows are not visible on the app pool
- **GIVEN** an audit row with a NULL `actor_user_id`
- **WHEN** the app pool queries `audit_events` for any user
- **THEN** that row is not returned

#### Scenario: The privileged pool sees all audit rows
- **GIVEN** a set of audit rows written with run-unique actor and resource values, including one with a
  NULL `actor_user_id`
- **WHEN** the privileged pool queries `audit_events` filtered to those run-unique values
- **THEN** every one of those rows is returned, for every actor, including the NULL-actor system row
- **AND** this is asserted over the run's own rows rather than the table's total contents, since
  `audit_events` cannot be cleaned between runs

### Requirement: AuditEventRepository access
The system SHALL provide an `AuditEventRepository` exposing `append`, `findByActor`, and
`findByResource`, using a value-class `AuditEventId` following the `DashboardId`/`PanelId` pattern,
with no inline fully-qualified names. The repository SHALL expose no update or delete operation.

The read operations SHALL take the authenticated caller's user id as an argument distinct from their
filter arguments, and SHALL pass that caller id — never a filter argument — as the RLS context user to
`DbContext.withUserContext`:

- `append(event): Future[AuditEventId]` (privileged pool)

`AuditEvent` as returned by the read operations SHALL carry its `AuditEventId` and its `created_at`, so
the later audit-query capability can page and link by id without a model change.

- `findByActor(callerUserId, actorUserId): Future[Seq[AuditEvent]]`
- `findByResource(callerUserId, resourceType, resourceId): Future[Seq[AuditEvent]]`

#### Scenario: append persists the event
- **WHEN** `append` is called with an audit event
- **THEN** a row is persisted carrying the given actor, source, action, resource type, resource id,
  and metadata

#### Scenario: The RLS context user is the caller, not the filter argument
- **WHEN** `findByActor` is called with a caller id and a different actor id
- **THEN** the RLS context user applied to the query is the caller id
- **AND** the owner policy therefore returns no rows, rather than being vacuously satisfied

#### Scenario: findByActor returns that actor's events newest-first
- **GIVEN** several audit rows exist for one actor
- **WHEN** `findByActor` is called for that actor
- **THEN** that actor's events are returned ordered by `created_at` descending

#### Scenario: findByResource returns events for that resource
- **GIVEN** audit rows exist for several resources
- **WHEN** `findByResource` is called with a resource type and id
- **THEN** only events for that resource are returned

#### Scenario: The repository surface offers no mutation
- **WHEN** the `AuditEventRepository` API is inspected
- **THEN** it exposes no operation that updates or deletes an existing audit event
