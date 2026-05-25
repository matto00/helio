## ADDED Requirements

### Requirement: Automated pg_class guard asserts FORCE RLS on all ACL'd tables
The test suite SHALL include a `RlsPolicyGuardSpec` that starts an embedded Postgres instance,
applies all Flyway migrations, and then queries `pg_class` and `pg_policies` to verify that
every table in the ACL'd allowlist has `relrowsecurity = true`, `relforcerowsecurity = true`,
and at least one policy defined. The spec SHALL fail with a descriptive error message naming
the table and the missing attribute if any expectation is violated.

#### Scenario: All expected tables have RLS enabled after migrations
- **WHEN** all Flyway migrations (V1 through the latest) are applied to a fresh embedded Postgres
- **THEN** every table in the allowlist (`pipelines`, `data_sources`, `data_types`,
  `pipeline_steps`, `pipeline_runs`, `data_type_rows`, `dashboards`, `panels`,
  `resource_permissions`) has `relrowsecurity = true` in `pg_class`

#### Scenario: All expected tables have FORCE RLS after migrations
- **WHEN** all Flyway migrations are applied to a fresh embedded Postgres
- **THEN** every table in the allowlist has `relforcerowsecurity = true` in `pg_class`

#### Scenario: All expected tables have at least one policy
- **WHEN** all Flyway migrations are applied to a fresh embedded Postgres
- **THEN** every table in the allowlist has at least one row in `pg_policies` for that table

#### Scenario: helio_privileged role exists with BYPASSRLS
- **WHEN** all Flyway migrations are applied to a fresh embedded Postgres
- **THEN** `pg_roles` contains a row where `rolname = 'helio_privileged'` and `rolbypassrls = true`

#### Scenario: Allowlist is the source of truth for future tables
- **WHEN** a new ACL'd table is added to the schema without RLS policies
- **THEN** the spec fails at build time if the table is present in the allowlist but missing
  `relrowsecurity` or `relforcerowsecurity`

### Requirement: Performance indexes exist for RLS policy predicates
The database schema SHALL include indexes that back the per-row predicates used by the RLS
policies added in V35 and V36, specifically `idx_panels_owner_id` on `panels(owner_id)` and a
composite index `idx_resource_permissions_resource_grantee` on
`resource_permissions(resource_type, resource_id, grantee_id)`.

#### Scenario: panels.owner_id index exists after V37 migration
- **WHEN** Flyway applies V37 to the database
- **THEN** an index named `idx_panels_owner_id` exists on the `panels` table covering the
  `owner_id` column

#### Scenario: resource_permissions composite index exists after V37 migration
- **WHEN** Flyway applies V37 to the database
- **THEN** an index named `idx_resource_permissions_resource_grantee` exists on the
  `resource_permissions` table covering `(resource_type, resource_id, grantee_id)`
