## ADDED Requirements

### Requirement: Flyway migration smoke confirms expected role and policy state
After all Flyway migrations are applied from a fresh database, the resulting Postgres state SHALL
be verifiable in an automated test. Specifically: `helio_privileged` role with `BYPASSRLS`,
all ACL'd tables with `FORCE ROW LEVEL SECURITY`, and at least one policy per table.

#### Scenario: Fresh-DB Flyway migration produces the expected role state
- **WHEN** Flyway applies all migrations to a completely empty Postgres database
- **THEN** the `helio_privileged` role exists with `BYPASSRLS = true` and `NOLOGIN = true`

#### Scenario: Fresh-DB Flyway migration produces RLS-enabled tables
- **WHEN** Flyway applies all migrations to a completely empty Postgres database
- **THEN** every ACL'd table in the allowlist has both `relrowsecurity` and `relforcerowsecurity`
  set to true in `pg_class`
