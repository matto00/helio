## Context

`PanelRepository` currently uses sequential `db.run` calls for ACL-gated panel reads:
`findAllByDashboardId` — 2 round-trips for the owner path (fetch dashboard, fetch panels),
3 for the grantee path (fetch dashboard, check permission, fetch panels), and 2-3 for the
anonymous path (fetch dashboard, check public grant, fetch panels). `findById` has the same
structure. Both methods live in `PanelRepository.scala`.

The `resource_permissions` table uses NULL `grantee_id` + `role='viewer'` to signal a
public-viewer grant. The `dashboards` table has no `is_public` column. Indexes on
`resource_permissions(resource_type, resource_id)` and `resource_permissions(grantee_id)`
exist (see Flyway migrations from HEL-265).

`DbContext` exposes `withSystemContext` (privileged pool, bypasses RLS) and
`withUserContext(userId)` (app pool, sets `app.current_user_id`). For reads that embed the
ACL predicate directly in SQL, `withSystemContext` is the correct context — the query itself
enforces access; `app.current_user_id` is not needed.

## Goals / Non-Goals

**Goals:**
- Collapse `findAllByDashboardId` to at most 1 `db.run` for all caller paths
- Collapse `findById` to at most 1 `db.run` for all caller paths
- EXPLAIN ANALYZE index scans on the `resource_permissions` JOIN
- Existing `DashboardPanelAclSpec` matrix passes unchanged

**Non-Goals:**
- Schema changes
- Changes to `DashboardRepository`, the HTTP route layer, or services
- Changing public-viewer semantics or adding an `is_public` column

## Decisions

**1. Single Slick for-comprehension with `exists` subquery**

Each method becomes one Slick query:
```
panels JOIN dashboards ON panels.dashboard_id = dashboards.id
WHERE panels.dashboard_id = <id>  (or panels.id = <id> for findById)
  AND (
    dashboards.owner_id = <callerId>                          -- owner
    OR EXISTS (SELECT 1 FROM resource_permissions WHERE ...)  -- grantee
    OR EXISTS (SELECT 1 FROM resource_permissions
               WHERE grantee_id IS NULL AND role = 'viewer')  -- public
  )
```

The public-viewer branch is always included; it short-circuits on a NULL literal when
`callerOpt` is defined (can use a `Rep[Boolean]` false literal for the owner/grantee
branches when caller is `None`). Slick's `||` on `Rep[Boolean]` maps directly to SQL `OR`.

**2. `withSystemContext` for both methods**

The ACL predicate is embedded in the query. No `app.current_user_id` session variable is
needed. Using `withSystemContext` avoids the `SET LOCAL` overhead of `withUserContext` and
is consistent with other system-privilege reads that resolve ownership internally.

**3. Preserve `PanelRow` → `Panel` mapping via `PanelRowMapper`**

The result shape is unchanged — still a `Seq[PanelRow]` from the panels table projection.
No tuple gymnastics needed; the dashboard/permission tables are only in the WHERE clause.

**4. Anonymous caller (callerOpt = None)**

When `callerOpt` is `None`, the owner and grantee branches are replaced with `false` literal
(`LiteralColumn(false)`). Only the public-viewer EXISTS branch can match.

## Risks / Trade-offs

- [Risk] Slick `exists` with a subquery targeting `resource_permissions` could produce a
  Seq-scan if the planner misjudges cardinality. Mitigation: add a ScalaTest assertion in
  `DashboardPanelAclSpec` that runs `EXPLAIN ANALYZE` on the grantee-path query and fails
  CI if "Seq Scan on resource_permissions" appears in the plan.

- [Risk] `LiteralColumn(false)` as a placeholder for absent owner/grantee branches is
  unusual in Slick. Mitigation: test all four paths in `DashboardPanelAclSpec` (owner,
  grantee, public-viewer, no-grant) to confirm correct pruning.

## Migration Plan

No Flyway migration. Single-file change to `PanelRepository.scala`. Deploy by
dropping in the new file — no rollout ordering required. Rollback is a file revert.

## Planner Notes

Self-approved: pure performance optimization, behavior-preserving, scope matches ticket
exactly. No new external dependencies, no API contract changes, no breaking changes.
EXPLAIN ANALYZE evidence is a hard acceptance criterion — executor must capture it.
