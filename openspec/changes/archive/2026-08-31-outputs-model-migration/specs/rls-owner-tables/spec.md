## MODIFIED Requirements

### Requirement: All six owner-only tables have RLS enabled with an owner policy
The Flyway migration V35 SHALL enable `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` on
`pipelines`, `pipeline_steps`, `pipeline_runs`, `data_sources`, and (as of the outputs-model
migration) `pipeline_steps` remains owner-only while `data_types` and `data_type_rows` are
dropped and replaced by the sharing-aware `outputs`/`node_snapshots` tables (see
`rls-sharing-aware-tables`, mirroring `pipelines`' V39 policy, not this owner-only set). Each
remaining table in this owner-only set SHALL have exactly one `USING` policy named
`<table>_owner` that restricts access to rows whose effective owner matches
`current_setting('app.current_user_id')::uuid`.

#### Scenario: Direct-owner table policy allows owner access
- **WHEN** a query runs inside `withUserContext(userId)` on `pipelines` or `data_sources`
- **THEN** only rows where `owner_id = userId::uuid` are returned

#### Scenario: Indirect-owner table policy allows owner access via parent
- **WHEN** a query runs inside `withUserContext(userId)` on `pipeline_steps` or `pipeline_runs`
- **THEN** only rows whose parent pipeline is owned by `userId` are returned

#### Scenario: All six tables have RLS enabled after V35 migration
- **WHEN** Flyway applies V35 to a fresh database
- **THEN** `SELECT relrowsecurity FROM pg_class WHERE relname IN ('pipelines','pipeline_steps','pipeline_runs','data_sources','data_types','data_type_rows')` returns true for all six rows (as of the outputs-model migration, `data_types` and `data_type_rows` no longer exist and are dropped from this check; the remaining four continue to satisfy it)
