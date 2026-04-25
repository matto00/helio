## Context

`AclDirective.authorizeResource` currently performs owner-only checks: it resolves the resource owner via a
caller-supplied `(id: String) => Future[Option[String]]` and returns 404/403/pass. Dashboard routes inline
the same pattern (`if dashboard.ownerId != user.id => complete(Forbidden)`). There is no sharing layer.

The system has full auth (`AuthDirectives.authenticate`) and an established pattern for optional auth
(some routes sit outside the `authenticate { ... }` block). `DashboardRepository`, `PanelRepository`, and
the Flyway migration chain (latest: V15) are stable.

## Goals / Non-Goals

**Goals:**
- `resource_permissions` table + `ResourcePermissionRepository` (insert, delete, listByResource)
- `PermissionRoutes` for `POST/DELETE/GET /api/dashboards/:id/permissions`
- Updated `AclDirective` with new `authorizeResourceWithSharing` directive that also checks grants
- Public viewer access (no auth required) for dashboards with a null-grantee viewer grant
- Panel access inherits dashboard permissions: panel routes check dashboard permissions for shared users

**Non-Goals:**
- Data-source / data-type sharing (owner-only as-is)
- RLS or Postgres-level enforcement
- Frontend UI for sharing

## Decisions

### 1. New directive alongside existing one, not replacing it

The existing `authorizeResource` covers data sources and data types (owner-only). A new
`authorizeResourceWithSharing` directive accepts the owner resolver AND a permission checker
`(resourceId: String, userId: String, role: String) => Future[Boolean]`. Adding a second directive avoids
breaking the existing caller sites while keeping the sharing logic isolated.

**Alternative considered**: extend `authorizeResource` with an optional permission checker — rejected because
optional parameters with Future callbacks make the signature ambiguous at call sites.

### 2. Single `resource_permissions` table for all resource types

`resource_type` VARCHAR + `resource_id` UUID covers dashboards today and any future resource. Unique
constraint on `(resource_type, resource_id, grantee_id)` (with `grantee_id` nullable treated as NULLS NOT
DISTINCT in Postgres 15+; for earlier Postgres we use a partial unique index for the null case).

### 3. Permission inheritance for panels via dashboard lookup

Panel routes receive a `dashboardId` from the panel record. When a shared user accesses a panel, we look up
the panel's `dashboardId` then call the same permission check against the dashboard's permissions. No
separate panel-level permission grants. This keeps the model simple and consistent with the ticket spec.

### 4. Public access without authentication

`POST /api/dashboards/:id/permissions` can create a row with `grantee_id = NULL, role = viewer`. Requests
without an `Authorization` header are checked against public grants before returning 401. In `ApiRoutes` the
public-dashboard GET routes are moved to sit outside the `authenticate {}` block, wrapped in an
`optionalAuthenticate` directive that resolves to `Option[AuthenticatedUser]`.

### 5. Role enforcement at route level, not directive level

Editor vs viewer distinction is enforced in the route handler, not inside `authorizeResourceWithSharing`,
because the set of "write" operations differs per route. The directive returns a `ResourceAccess` value
(Owner | Editor | Viewer) that the route handler pattern-matches on.

### 6. Flyway migration V16

Single migration creates the `resource_permissions` table. Role is stored as VARCHAR with a CHECK constraint
(`role IN ('viewer', 'editor')`). grantee_id is nullable (UUID references users).

## Risks / Trade-offs

- [Partial unique index for null grantee] Postgres < 15 lacks `NULLS NOT DISTINCT`; partial unique index
  `WHERE grantee_id IS NULL` is the portable workaround. → Mitigation: use the partial index.
- [N+1 on panel access] Each panel request now potentially does a second DB query to check dashboard
  permission. → Mitigation: single indexed query; acceptable for current scale.
- [Public routes bypass authenticate] Moving public-dashboard GETs outside the auth block changes the route
  tree structure in `ApiRoutes`. → Mitigation: audit all dashboard routes; only GET /api/dashboards/:id
  and GET /api/dashboards/:id/panels gain public access; write routes remain auth-required.

## Migration Plan

1. Deploy V16 Flyway migration (no downtime — additive table).
2. All existing dashboard/panel access is unaffected (no rows in `resource_permissions` means owner-only).
3. Rollback: drop `resource_permissions` table; revert `AclDirective` and `DashboardRoutes` changes.

## Planner Notes

- Self-approved: no breaking changes to existing endpoints, additive DB migration only.
- `PermissionRoutes` will be wired into `ApiRoutes` under `pathPrefix("dashboards")` alongside existing
  `DashboardRoutes`, sharing the same `authenticate` guard for write operations.
- `optionalAuthenticate` will be a new directive in `AuthDirectives` returning
  `Directive1[Option[AuthenticatedUser]]` using `optionalHeaderValueByType`.
