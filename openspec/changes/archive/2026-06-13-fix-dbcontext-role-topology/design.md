## Context

`DbContext` production code correctly separates two HikariCP pools: an app pool (no BYPASSRLS) and
a privileged pool (`connectionInitSql = "SET ROLE helio_privileged"`). However the existing tests
all use `new DbContext(db, db)` where both pools share an EmbeddedPostgres superuser datasource.
A superuser implicitly bypasses all privilege checks, so missing GRANTs (like the V38 bug) and RLS
policy gaps are structurally invisible.

Existing specs:
- `RlsPolicyGuardSpec` — structural: confirms RLS is enabled + policies exist (superuser pool, V34-V37).
- `DbContextSpec` — role topology test: verifies `helio_privileged` is the active role on
  the privileged pool and `withUserContext` does not gain BYPASSRLS. Privileged pool uses HikariCP
  with `SET ROLE helio_privileged`; app pool uses a raw (superuser) datasource.
- `RlsOwnerTablesSpec` / `RlsSharingAwareTablesSpec` — row filtering: verify RLS policies
  actually filter rows for a non-superuser `helio_app_test` role on the app pool.

None of these explicitly assert that `helio_privileged` has the table-level DML GRANTs it needs
(the V38 class of bug). The `RlsOwnerTablesSpec` `cleanDb` and seed helpers call `withSystemContext`
with INSERT/TRUNCATE, but those succeed only because V38 already shipped; there is no _assertion_
that would fail if the GRANTs were revoked.

## Goals / Non-Goals

**Goals:**
- Add `RlsPrivilegedDmlSpec` — a dedicated spec that asserts `withSystemContext` (running as
  `helio_privileged`) can INSERT, UPDATE, and DELETE on every ACL'd table in the schema.
- Use a non-superuser app pool (same `helio_app_test` pattern as `RlsOwnerTablesSpec`) so neither
  pool hides privilege gaps via superuser access.
- If any future migration adds an ACL'd table and forgets to include it in the allowlist, this
  spec fails.
- `withUserContext` via the non-superuser app pool is RLS-filtered (a spot-check query on one
  table verifies that rows not belonging to the requesting user are hidden).

**Non-Goals:**
- Changing `DbContextSpec`, `RlsOwnerTablesSpec`, or `RlsSharingAwareTablesSpec`.
- Boot-level smoke test against a non-superuser provisioned Postgres (noted in ticket as
  "consider" — deferred).
- Testing every RLS policy predicate (that's `RlsOwnerTablesSpec` / `RlsSharingAwareTablesSpec`).

## Decisions

**D1 — New spec file, not modifying existing specs.**
`RlsOwnerTablesSpec` and `RlsSharingAwareTablesSpec` are written as row-filtering correctness tests;
the DML coverage concern is orthogonal and benefits from an isolated spec with a clear stated purpose.

**D2 — Test all nine ACL'd tables explicitly.**
The allowlist mirrors `RlsPolicyGuardSpec.rlsTables` (V35: pipelines, pipeline_steps, pipeline_runs,
data_sources, data_types, data_type_rows; V36: dashboards, panels, resource_permissions).
Adding a new ACL'd table without updating this spec causes a test failure (new table isn't in the
allowlist → devs notice and add it → test coverage follows the schema).

**D3 — DML assertion strategy: INSERT + SELECT + DELETE per table.**
For each ACL'd table, the test does a privileged INSERT (would fail without table GRANT), confirms
the row is readable via `withSystemContext` (BYPASSRLS), then deletes it. This directly exercises
the code path that was missing in production before V38.

**D4 — App pool is `helio_app_test` (non-superuser), NOT a raw EmbeddedPostgres datasource.**
Follows the pattern already established in `RlsOwnerTablesSpec`. The login user is `postgres`
(required for EmbeddedPostgres), which immediately does `SET ROLE helio_app_test` via
`connectionInitSql`. `helio_app_test` is a NOLOGIN, non-BYPASSRLS role — privilege gaps are visible.

**D5 — Self-approved.** No new external dependencies; follows established codebase patterns;
purely additive (new test file only).

## Risks / Trade-offs

- [Risk] EmbeddedPostgres overhead: a third embedded Postgres instance in the test suite.
  → Mitigation: EmbeddedPostgres instances are lightweight in CI; existing suite already boots
  three separate instances (`RlsPolicyGuardSpec`, `RlsOwnerTablesSpec`, `RlsSharingAwareTablesSpec`,
  `DbContextSpec`). Acceptable.
- [Risk] Allowlist drift if a new ACL'd table is added without updating this spec.
  → By design: that's the intended failure signal. Devs update both the migration and the spec.

## Planner Notes

Self-approved. This is a purely additive, test-only change. No architectural ambiguity, no
external dependencies, no breaking changes.
