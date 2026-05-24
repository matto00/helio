## Context

The HEL-273/274 batch already introduced `DbContext` (two-pool architecture) and the
`helio_privileged` BYPASSRLS role (V34 migration). No RLS policies exist yet on any table.
The six "owner-only" tables (pipelines, pipeline_steps, pipeline_runs, data_sources,
data_types, data_type_rows) are the simplest case: one direct or one-hop indirect owner column,
no sharing semantics. The repository layer already enforces ACL at the app layer (HEL-265 CS2);
this change adds the DB-layer backstop.

## Goals / Non-Goals

**Goals:**
- Enable RLS + FORCE on all six tables via V35 Flyway migration.
- One `USING` policy per table keyed on `current_setting('app.current_user_id')::uuid`.
- Indirect tables (pipeline_steps, pipeline_runs, data_type_rows) use `EXISTS` subqueries
  against their parent table's `owner_id`.
- Repository write paths currently using `withSystemContext` as HEL-275 placeholders are
  migrated to `withUserContext`.
- New integration test proves fail-closed and cross-user isolation at the DB layer.

**Non-Goals:**
- Dashboards, panels, resource_permissions (sharing-aware — next ticket).
- GRANTs to a `helio_app` named role: DB_USER is the login role; the app pool runs as
  DB_USER without a named app role. The migration needs no additional GRANT work.
- Row-level GRANT policies: `USING` covers SELECT/UPDATE/DELETE; `WITH CHECK` is omitted
  because existing app-layer owner enforcement covers INSERT semantics and the RLS USING
  clause alone is sufficient for the fail-closed goal on reads.

## Decisions

**D1 — FORCE ROW LEVEL SECURITY**: Use `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so the table owner
(who would normally bypass RLS) is also subject to the policy. Production DB_USER owns the tables;
without FORCE, DB_USER connections bypass all policies.

**D2 — current_setting with error-on-missing**: The policy uses `current_setting('app.current_user_id')`
without `missing_ok = true`. When the session variable is unset (no `SET LOCAL` was issued) Postgres
raises an error, which is strictly safer than silently returning 0 rows. However, `withSystemContext`
connections bypass RLS entirely via BYPASSRLS, so the variable is never evaluated on the privileged pool.
The fail-closed test verifies the app pool raises an error when no variable is set.

**D3 — EXISTS subquery for indirect tables**: pipeline_steps, pipeline_runs, data_type_rows do not
carry their own `owner_id`. Their policies JOIN to the parent table's `owner_id` via `EXISTS (SELECT 1 ...)`.
The parent table (pipelines / data_types) also has RLS; the EXISTS subquery runs in the same transaction
context, so the parent's RLS also evaluates — this is safe because the privileged pool bypasses both.

**D4 — Repository write path migration**: `DataSourceRepository.insert/update/updateStaticPayload/delete`,
`DataTypeRepository.insert/update/delete`, and `PipelineStepRepository.insert` carry TODO comments marked
"HEL-275 placeholder". They must accept a `user: AuthenticatedUser` parameter and call
`withUserContext(user.id.value)` so the new RLS USING policy can evaluate on write.
Callers already pass the user; the call signatures need updating.
The `*Internal` variants (privileged Spark driver path) remain on `withSystemContext` — correct by design.

**D5 — data_type_rows policy**: `overwriteRows` and `listRows` in `DataTypeRowRepository` are called
exclusively from `PipelineRunService` (background privileged path). They stay on `withSystemContext`.
The RLS policy on `data_type_rows` is therefore only exercised via the privileged bypass, but enabling
it is still the right posture: it ensures the DB-layer boundary holds if a non-privileged path is ever
mistakenly added.

**D6 — Flyway privilege**: V34 already grants `helio_privileged` to `current_user` (the Flyway login).
As a superuser in test and a grantee in production, Flyway has sufficient privilege to
`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY`. No additional migration scaffolding needed.

**D7 — Test strategy**: A new `RlsOwnerTablesSpec` uses EmbeddedPostgres + full Flyway (same pattern as
`DbContextSpec`). It builds two pools (app + privileged), creates two synthetic users (inserting into
`users` via the privileged pool), then:
- Verifies the app pool with no `SET LOCAL` raises an error (fail-closed).
- Verifies `withUserContext(userA)` on each table returns only userA's rows.
- Verifies `withUserContext(userB)` cannot read userA's rows.
- Verifies `withSystemContext` sees all rows (BYPASSRLS).

## Risks / Trade-offs

- [RISK] Flyway migration ordering: next migration must be V35. Confirmed: V34 = rls_privileged_role.
  → Mitigation: file is named `V35__rls_owner_only_tables.sql`.
- [RISK] data_types.owner_id and data_sources.owner_id are NULLABLE (V14/V15 did not add NOT NULL).
  RLS policy `owner_id = current_setting(...)::uuid` evaluates to NULL for NULL owner rows → excluded
  silently. Legacy / system-seeded rows with NULL owner_id become invisible to user-context queries.
  → Mitigation: The DemoData seeder and any existing V1-seeded rows should have valid owner IDs from
    HEL-265 CS2 backfill. NULL owner_id rows will only appear if code inserts without an owner, which
    the updated repository write paths prevent.
- [RISK] `withSystemContext` double-transactionally wrapping. `withSystemContext` already calls
  `.transactionally`; if the action also calls `.transactionally`, nested savepoints are used.
  This is existing behavior, not new risk.

## Migration Plan

1. Apply V35 via normal Flyway auto-run on backend startup.
2. No rollback DDL needed for development; for production a V36 could DROP POLICYs + DISABLE RLS if needed.
3. All repository call-site changes are Scala-compile-time checked — no silent migration failure mode.

## Open Questions

None. All decisions above are self-approved (no external dependency, no new architectural pattern).

## Planner Notes

Self-approved. No ESCALATION needed:
- No new external dependencies.
- No breaking API changes (RLS is transparent to callers — the app-layer filters were already equivalent).
- No scope beyond the ticket.
- Repository signature changes are additive (adding a `user` param to write methods);
  all callers already have access to the `AuthenticatedUser` from the route directive.
