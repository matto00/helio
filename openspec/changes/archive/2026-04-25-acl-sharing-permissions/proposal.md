## Why

Helio dashboards are currently private to their owner with no way to share them. Adding per-resource
permissions unlocks collaboration and public read-only links, which are table-stakes for a dashboard SaaS.

## What Changes

- New `resource_permissions` table persists grants: `resource_type`, `resource_id`, `grantee_id` (nullable
  for public access), `role` enum `viewer | editor`
- New permission management endpoints on dashboards: `POST /:id/permissions`, `DELETE /:id/permissions/:granteeId`,
  `GET /:id/permissions` (owner-only)
- `AclDirective` extended to check `resource_permissions` for non-owners: editors may modify panels but cannot
  delete the dashboard or change permissions; viewers are read-only
- Public dashboards (grantee_id IS NULL, role = viewer) are accessible without authentication
- Panel access inherits from the parent dashboard's permissions — panels are not shared independently

## Non-goals

- Data-source and data-type sharing (owner-only for now)
- Row-level security (RLS) in PostgreSQL
- Frontend sharing UI (backend contract only)
- Dashboard-to-dashboard permission inheritance

## Capabilities

### New Capabilities

- `resource-permissions`: Persist and enforce per-resource viewer/editor grants, including public access

### Modified Capabilities

- `acl-enforcement`: Extend from owner-only to also allow access for grantees with matching role; add
  unauthenticated public-viewer pass-through

## Impact

- Backend: new Flyway migration, new `ResourcePermissionRepository`, new `PermissionRoutes`, updated
  `AclDirective`, updated `ApiRoutes`
- Schemas: new request/response types for permission grant/revoke/list
- No frontend changes required for this ticket
