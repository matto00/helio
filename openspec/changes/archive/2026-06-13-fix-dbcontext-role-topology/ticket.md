# HEL-285: [Test gap] DbContext tests share one superuser datasource — never exercise the real helio_privileged role

## Background

During the HEL-272 RLS epic, a **prod-breaking bug shipped past a 809-test green suite** and was only caught by a manual local dual-pool smoke boot: `helio_privileged` (created in V34 with `BYPASSRLS`) was never granted table-level DML, so the backend crashed on startup with `permission denied for table dashboards` the moment the privileged pool ran `SET ROLE helio_privileged` against a genuinely separate connection (i.e. production). Fixed by V38 (`HEL-274 Grant helio_privileged table-level DML`).

## Root cause of the coverage gap

`DbContext` is constructed in tests as `new DbContext(db, db)` — **both the app pool and the privileged pool point at the same EmbeddedPostgres datasource, which connects as a superuser**. Two consequences:

1. The privileged pool's `connectionInitSql = "SET ROLE helio_privileged"` (defined only on the real HikariCP pool in `application.conf`) is **never executed** in tests.
2. The shared connection is a **superuser**, which bypasses RLS *and* has implicit access to every table — so missing GRANTs on `helio_privileged` are invisible.

Net: no test ever ran a query *as* `helio_privileged`, so neither the missing table grant nor any future privileged-role permission regression can be caught.

## What to do

* Add an integration test (or test harness) that exercises the **real two-role topology**: a non-superuser app login role (RLS-enforced) for the app pool and the `helio_privileged` role (via `SET ROLE`) for the privileged pool — mirroring production. The existing `RlsOwnerTablesSpec` / `RlsSharingAwareTablesSpec` already create a non-BYPASSRLS test pool; extend that pattern so `withSystemContext` actually runs as `helio_privileged` rather than the superuser.
* Assert `withSystemContext` can perform DML on every ACL'd table (would have caught the V38 bug), and that `withUserContext` as the non-superuser app role is RLS-filtered + fail-closed.
* Consider a lightweight **boot-level smoke test** in CI that starts the app against a non-superuser-provisioned Postgres (app role + privileged role, no superuser) and asserts a clean startup + a seeded read — this is the layer the unit tests structurally cannot cover.

## Acceptance Criteria

* A test fails if `helio_privileged` lacks the privileges it needs to run `withSystemContext` DML on any ACL'd table.
* The privileged-pool `SET ROLE` path is genuinely exercised (not collapsed onto a superuser datasource).
* CI would catch the class of bug that V38 fixed before it reaches a real deployment.

## Related

* HEL-274 — created the `helio_privileged` role; the missing-grant bug + V38 fix live here
* HEL-277 — RLS verification pass (added `RlsPolicyGuardSpec`, which checks RLS/policy presence but not privileged-role DML capability)
* HEL-272 — RLS epic
