## 1. Tests

- [x] 1.1 Create `RlsPrivilegedDmlSpec.scala` in `backend/src/test/scala/com/helio/infrastructure/` with a two-role EmbeddedPostgres setup: privileged pool uses HikariCP `SET ROLE helio_privileged`; app pool uses HikariCP `SET ROLE helio_app_test` (non-superuser, non-BYPASSRLS).
- [x] 1.2 Seed two owner users and assert `withSystemContext` can INSERT a row into each of the nine ACL'd tables: `data_sources`, `data_types`, `pipelines`, `pipeline_steps`, `pipeline_runs`, `data_type_rows`, `dashboards`, `panels`, `resource_permissions`.
- [x] 1.3 Assert `withSystemContext` can UPDATE a field on an inserted row for at least `data_sources` and `dashboards` (representative of owner-only and sharing-aware groups).
- [x] 1.4 Assert `withSystemContext` can DELETE an inserted row for at least `data_sources` and `dashboards`.
- [x] 1.5 Assert `withSystemContext SELECT current_role` returns `helio_privileged` (privileged pool active role sanity check).
- [x] 1.6 Assert `withUserContext(ownerA)` on the non-superuser app pool returns only ownerA's `data_sources` row and not ownerB's (RLS-filtered spot-check).
- [x] 1.7 Run `sbt test` (or targeted spec) and confirm all new tests pass; confirm no existing tests regress.
