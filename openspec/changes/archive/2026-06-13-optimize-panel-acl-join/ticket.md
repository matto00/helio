# HEL-281: Optimize sharing-aware panel list to a single JOIN query

## Title
Optimize sharing-aware panel list to a single JOIN query

## Description

### Context

Surfaced during HEL-265 CS4 implementation. `PanelRepository.findAllByDashboardId(dashboardId, callerOpt)` is sharing-aware and uses 2-3 sequential `db.run` round-trips in the grantee path:

1. Fetch the parent dashboard
2. Check the caller's `resource_permissions` grant
3. Fetch the panels

The owner path is a single query (no grant lookup needed). The performance smoke in CS5 didn't show a hot-path regression at small data sizes, but this becomes a real cost at scale — every public dashboard page load for a grantee viewer triggers 2-3 round trips when 1 would do.

### Scope

Collapse the sharing-aware panel list into a single Slick query with a JOIN against `dashboards` + `resource_permissions`:

```sql
SELECT p.*
FROM panels p
JOIN dashboards d ON p.dashboard_id = d.id
WHERE p.dashboard_id = ?
  AND (
    d.owner_id = ?  -- caller is owner
    OR EXISTS (
      SELECT 1 FROM resource_permissions rp
      WHERE rp.resource_type = 'dashboard'
        AND rp.resource_id = d.id
        AND rp.grantee_id = ?
    )
    OR d.is_public = true  -- public-viewer fallback when callerOpt = None
  )
```

The same optimization applies to `PanelRepository.findById(id, callerOpt)`.

### Constraints

* Behavior-preserving — the test matrix from `DashboardPanelAclSpec` must still pass unchanged
* The public-viewer fallback path (`callerOpt = None`) needs the `is_public = true` branch
* EXPLAIN ANALYZE must show an index scan, not a seq scan, on `resource_permissions`

## Acceptance Criteria

1. `findAllByDashboardId(dashboardId, callerOpt)` performs at most 1 `db.run` for all paths (owner, grantee, public-viewer, no-grant)
2. `findById(id, callerOpt)` performs at most 1 `db.run`
3. EXPLAIN ANALYZE confirms index scans on the JOIN
4. Existing tests pass unchanged
5. No regression in the public-viewer fallback path

## Related

* Source: HEL-265 CS4 executor report — flagged as inline optimization candidate
* Coordinate with HEL-276 (RLS on sharing-aware tables) — once RLS is on, the policy executes the same JOIN at the DB layer; we want the app-layer query to also be efficient

## Notes

HEL-133 (PR #185) changed findAllByDashboardId to return PagedResult — if the worktree base already contains that change, preserve the pagination; if not, don't worry about it.
