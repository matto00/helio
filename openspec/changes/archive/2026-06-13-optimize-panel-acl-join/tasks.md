## 1. Backend

- [x] 1.1 Rewrite `PanelRepository.findAllByDashboardId` as a single Slick JOIN query
      covering owner, grantee, and public-viewer (NULL grantee_id) paths via `withSystemContext`
- [x] 1.2 Rewrite `PanelRepository.findById` as a single Slick JOIN query covering the same
      four paths (owner, grantee, public-viewer, no-grant) via `withSystemContext`
- [x] 1.3 Remove the `PipeOps` helper class if no longer used after the rewrite

## 2. Tests

- [x] 2.1 Run `DashboardPanelAclSpec` and confirm all existing tests pass unchanged
- [x] 2.2 Add a ScalaTest test (inside `DashboardPanelAclSpec` or a companion spec) that runs
      `EXPLAIN ANALYZE` via raw SQL on the grantee-path query, asserts the plan string contains
      "Index Scan" or "Index Only Scan" on `resource_permissions`, and asserts no "Seq Scan on
      resource_permissions" appears — this is the CI gate for AC3
- [x] 2.3 Run the full backend test suite (`sbt test`) and confirm zero regressions
