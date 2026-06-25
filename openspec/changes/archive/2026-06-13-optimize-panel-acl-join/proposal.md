## Why

`PanelRepository.findAllByDashboardId` and `findById` use 2–3 sequential `db.run`
round-trips for grantee and anonymous callers, inflating latency on every shared-dashboard
page load. Collapsing each into a single JOIN query eliminates the extra round-trips with
no visible behavior change.

## What Changes

- `PanelRepository.findAllByDashboardId(dashboardId, callerOpt)` — rewritten as one
  Slick query joining `panels`, `dashboards`, and `resource_permissions` with a WHERE
  clause covering owner, grantee, and public-viewer (NULL grantee_id + role='viewer') paths.
- `PanelRepository.findById(id, callerOpt)` — same collapse: single JOIN instead of
  sequential fetch-dashboard then check-permission then return-panel.
- Both methods use `withSystemContext` (privileged pool) because the ACL predicate is
  evaluated inside SQL rather than at the Scala call level; the sharing logic does not
  rely on `app.current_user_id` RLS — it is explicit in the WHERE clause.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `acl-enforcement`: implementation-level change to panel ACL read paths — no requirement
  changes, no API contract changes; marking as modified to track the delta.

## Impact

- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — two methods rewritten
- No Flyway migration needed (no schema changes)
- `DashboardPanelAclSpec` matrix must pass unchanged (behavior-preserving)
- EXPLAIN ANALYZE evidence captured and included in the PR

## Non-goals

- Schema changes (no `is_public` column added to `dashboards`)
- Any change to `DashboardRepository` methods
- Changes to the HTTP route layer or service layer
- Pagination changes (preserve `PagedResult` return type if HEL-133 is present in base)
