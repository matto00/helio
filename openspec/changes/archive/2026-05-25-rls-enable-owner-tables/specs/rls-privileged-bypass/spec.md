## ADDED Requirements

### Requirement: withSystemContext bypasses RLS on all owner-only tables
The `withSystemContext` pool SHALL bypass RLS policies on the six owner-only tables added by HEL-275
(`pipelines`, `pipeline_steps`, `pipeline_runs`, `data_sources`, `data_types`, `data_type_rows`),
returning all rows regardless of `app.current_user_id`.

#### Scenario: Privileged pool reads across all owners on a FORCE RLS table
- **WHEN** `withSystemContext` queries a table with `FORCE ROW LEVEL SECURITY` enabled
- **THEN** all rows are returned because `helio_privileged` carries BYPASSRLS, which takes
  precedence over FORCE ROW LEVEL SECURITY

#### Scenario: Flyway V35 migration runs successfully with BYPASSRLS privilege
- **WHEN** Flyway applies V35 (ALTER TABLE ... ENABLE ROW LEVEL SECURITY, CREATE POLICY)
- **THEN** the migration completes without error because the Flyway login role has
  `helio_privileged` granted (from V34) and therefore has sufficient privilege to create policies
  on tables it owns
