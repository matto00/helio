## MODIFIED Requirements

### Requirement: Automated pg_class guard asserts FORCE RLS on all ACL'd tables
The test suite SHALL include a `RlsPolicyGuardSpec` that starts an embedded Postgres instance,
applies all Flyway migrations, and then queries `pg_class` and `pg_policies` to verify that
every table in the ACL'd allowlist has `relrowsecurity = true`, `relforcerowsecurity = true`,
and at least one policy defined. The spec SHALL fail with a descriptive error message naming
the table and the missing attribute if any expectation is violated. The allowlist SHALL include
`outputs`, `node_snapshots`, `audit_events`, and `connector_credentials`, and SHALL no longer
include `data_types`, `data_type_rows`, or `metrics`.

#### Scenario: All expected tables have RLS enabled after migrations
- **WHEN** all Flyway migrations (V1 through the latest) are applied to a fresh embedded Postgres
- **THEN** every table in the allowlist (`pipelines`, `data_sources`, `outputs`, `node_snapshots`,
  `pipeline_steps`, `pipeline_runs`, `dashboards`, `panels`, `resource_permissions`,
  `audit_events`, `connector_credentials`) has `relrowsecurity = true` in `pg_class`

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

#### Scenario: data_types and metrics are no longer in the allowlist
- **WHEN** the outputs-model migration drops `data_types`, `data_type_rows`, and `metrics`
- **THEN** the allowlist no longer names them, and the guard does not fail looking for tables
  that no longer exist
