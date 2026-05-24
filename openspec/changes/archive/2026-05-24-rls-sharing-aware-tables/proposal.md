## Why

HEL-275 enabled FORCE RLS on the six owner-only tables. Three tables that carry
sharing semantics — `dashboards`, `panels`, and `resource_permissions` — were
left unprotected because their policies are more complex: a row must be visible
to the owner AND to any user or anonymous viewer that has a matching grant. The
DB layer must enforce this so any future query path or admin tool is fail-closed
rather than relying solely on service-layer guards.

## What Changes

- **New Flyway migration** `V36__rls_sharing_aware_tables.sql` enables FORCE ROW
  LEVEL SECURITY on `dashboards`, `panels`, and `resource_permissions`.
- **SECURITY DEFINER helper function** `helio_can_access_dashboard(dashboard_id TEXT)`
  encapsulates the shared SELECT predicate (owner OR grantee OR public-viewer)
  so `panels` policy can reuse it without duplicating SQL.
- **`dashboards` policies**: SELECT allows owner, named grantee, or anonymous
  with a public-viewer grant; UPDATE allows owner or editor grantee; DELETE
  restricted to owner only.
- **`panels` policies**: SELECT and UPDATE delegate to
  `helio_can_access_dashboard`; DELETE restricted to owner's dashboard only.
- **`resource_permissions` policies**: SELECT visible to the resource owner
  (via join to `dashboards.owner_id`) or the named grantee; INSERT/UPDATE/DELETE
  restricted to the resource owner.
- **New `RlsSharingAwareTablesSpec`** proves DB-layer isolation: owner sees own
  rows, grantee sees shared rows, non-grantee sees nothing, resource_permissions
  rows don't leak.
- Placeholder comments in `DashboardRepository` and `PanelRepository` updated
  to reflect that RLS is now active.

## Capabilities

### New Capabilities

- `rls-sharing-aware-tables`: DB-layer RLS policies for dashboards, panels, and
  resource_permissions — encoding owner-OR-grantee semantics.

### Modified Capabilities

- `resource-permissions`: SELECT visibility now enforced at the DB layer in
  addition to the service layer.

## Impact

- Backend: one new Flyway migration, one new SECURITY DEFINER function, one new
  Scala test file, two repository files updated (comment-only).
- Frontend: none.
- APIs: no shape changes — behavior change is restricted to the DB layer.
- The `helio_privileged` BYPASSRLS pool (HEL-274) continues to bypass all
  new policies; withSystemContext callers are unaffected.

## Non-goals

- Performance verification (final sub-ticket).
- EXPLAIN ANALYZE automation in tests.
- Changing the service-layer ACL logic (AuthService is off-limits).
