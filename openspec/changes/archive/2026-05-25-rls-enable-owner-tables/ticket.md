# HEL-275 — Enable RLS on owner-only tables (pipelines, types, sources, runs, steps, rows)

## Scope

First wave of HEL-272 policy enablement. The "easy" tables — single-column owner check, no sharing semantics.

Blocked by: HEL-273 (session-var infra) + HEL-274 (privileged-bypass mechanism). Both are already on the batch branch.

## Tables in scope

| Table            | Owner column | Notes                                                  |
| ---------------- | ------------ | ------------------------------------------------------ |
| `pipelines`      | `owner_id`   | added in HEL-265 V32                                   |
| `pipeline_steps` | indirect via `pipeline_id` → `pipelines.owner_id` | policy needs subquery |
| `pipeline_runs`  | indirect via `pipeline_id` → `pipelines.owner_id` | policy needs subquery |
| `data_sources`   | `owner_id`   | existing                                               |
| `data_types`     | `owner_id`   | existing                                               |
| `data_type_rows` | indirect via `data_type_id` → `data_types.owner_id` | policy needs subquery |

## Policy template (owner-only, direct column)

```sql
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipelines_owner ON pipelines
  USING (owner_id = current_setting('app.current_user_id')::uuid);
```

## Policy template (indirect, via parent)

```sql
ALTER TABLE pipeline_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipeline_steps_owner ON pipeline_steps
  USING (EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = pipeline_steps.pipeline_id
      AND p.owner_id = current_setting('app.current_user_id')::uuid
  ));
```

## Tasks

- Flyway `V35__rls_owner_only_tables.sql` with `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` per table
  (V33 = jsonb_columns from HEL-132, V34 = rls_privileged_role from HEL-274, so next is V35)
- Verify existing ACL test suites pass with RLS enabled (app-layer + RLS-layer enforcement together)
- New RLS isolation tests: prove fail-closed (no SET LOCAL → 0 rows), single-user isolation, cross-user isolation
- EXPLAIN on hot read paths confirms index usage on owner_id (no new seq scans)
- Update DataSourceRepository, DataTypeRepository, DataTypeRowRepository, PipelineStepRepository:
  - Methods still using `withSystemContext` as a "placeholder until HEL-275" must switch to `withUserContext`
    for the user-bound write paths. The *Internal variants stay on withSystemContext (they are legitimately privileged).

## Critical context from batch branch

### HEL-273: DbContext
`DbContext.withUserContext(userId)(action)` — runs on app pool inside a transaction with `SET LOCAL app.current_user_id = userId`.
`DbContext.withSystemContext(action)` — runs on privileged pool (helio_privileged BYPASSRLS role).

### HEL-274: V34 migration
Creates `helio_privileged` role with BYPASSRLS and grants it to `current_user` (the Flyway/DB_USER login role).
The privileged pool uses `connectionInitSql = "SET LOCAL ROLE helio_privileged"`.
Flyway runs as `current_user` who has `helio_privileged` granted, so Flyway can CREATE TABLE / ALTER TABLE / CREATE POLICY without being blocked by existing RLS.

### Existing RLS in repositories (from HEL-265 CS2)
- PipelineRepository: all public methods already use withUserContext; findByIdInternal/updateLastRunInternal use withSystemContext — correct
- DataSourceRepository: findAll/findByIdOwned use withUserContext; insert/update/updateStaticPayload/delete/readRawConfig use withSystemContext with HEL-275 TODO comments
- DataTypeRepository: findAll/findByIdOwned/findByIdsOwned use withUserContext; insert/update/delete use withSystemContext with HEL-275 TODO comments
- DataTypeRowRepository: overwriteRows/listRows use withSystemContext (pipeline engine path — legitimately privileged; stays withSystemContext)
- PipelineStepRepository: listByPipeline/findById/update/delete(partial) use withUserContext; insert uses withSystemContext with HEL-275 TODO comment
- PipelineRunRepository: insertRunInternal/insertDryRunInternal/updateRunTerminalInternal/deleteOldRunsInternal/deleteOldDryRunsInternal use withSystemContext (legitimately privileged Spark driver paths — stays withSystemContext)

## Acceptance criteria

1. All 6 tables in scope have RLS enabled + policy (V35 Flyway migration)
2. Existing test suites pass unchanged (owner-scoped queries still work)
3. Fail-closed regression tests pass: withUserContext with no SET LOCAL yields 0 rows
4. Cross-user isolation: withUserContext(userA) cannot see userB's rows
5. EXPLAIN shows no new seq scans on hot paths (owner_id indexes exist from HEL-265)

## Out of scope

- Sharing-aware tables: `dashboards`, `panels`, `resource_permissions` (next sub-ticket HEL-276+)
- AuthService (off-limits)
