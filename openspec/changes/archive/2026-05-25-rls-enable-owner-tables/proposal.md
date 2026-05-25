## Why

Row Level Security infrastructure (HEL-273 session-var injection, HEL-274 privileged-bypass role) is on the batch branch but no actual table policies exist yet. Without policies, RLS is "available but not protecting anything"; the first wave enables enforcement on the six owner-only tables so a compromised app-pool connection cannot read another user's data at the database layer.

## What Changes

- New Flyway migration `V35__rls_owner_only_tables.sql`: enables RLS + FORCE on
  `pipelines`, `pipeline_steps`, `pipeline_runs`, `data_sources`, `data_types`, `data_type_rows`;
  creates one `USING` policy per table keyed on `app.current_user_id`.
- Repository write paths that carried `withSystemContext` as a HEL-275 placeholder are
  converted to `withUserContext` so the new RLS policies enforce on user-bound inserts/updates/deletes:
  - `DataSourceRepository.insert`, `update`, `updateStaticPayload`, `delete`
  - `DataTypeRepository.insert`, `update`, `delete`
  - `PipelineStepRepository.insert`
- New `RlsOwnerTablesSpec` integration test: EmbeddedPostgres + full Flyway, two synthetic users,
  proves fail-closed and cross-user isolation at the DB layer.
- Existing repository specs remain green: the owner-scoped query filters the specs already use
  are now doubly enforced (app-layer AND RLS).

## Capabilities

### New Capabilities
- `rls-owner-tables`: Row Level Security policies on the six owner-only tables, with DB-layer
  isolation proving fail-closed and cross-user separation.

### Modified Capabilities
- `rls-privileged-bypass`: Requirements extended — the new policies must be transparent to
  `withSystemContext` (BYPASSRLS) callers; the spec gains scenarios for this.

## Impact

- **Backend**: one new Flyway migration; three repository files (DataSourceRepository,
  DataTypeRepository, PipelineStepRepository) updated; one new test file added.
- **Frontend**: no change.
- **APIs**: no change — ACL semantics were already enforced at the app layer; this adds a DB-layer
  backstop for the same rules.
- **Non-goals**: dashboards, panels, resource_permissions (sharing-aware tables, HEL-276+).
