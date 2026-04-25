# HEL-36: ACL model: sharing & per-resource permissions

## Summary

Allow resource owners to grant other users (or the public) access to their dashboards and panels.

## Scope

- `resource_permissions` table: `resource_type`, `resource_id`, `grantee_id` (nullable for public), `role` enum (`viewer` | `editor`)
- `POST /api/dashboards/:id/permissions` — grant access
- `DELETE /api/dashboards/:id/permissions/:granteeId` — revoke access
- `GET /api/dashboards/:id/permissions` — list grants (owner only)
- Public dashboards: accessible without auth when `grantee_id` is null and `role = viewer`

## Acceptance Criteria

- Owners can share dashboards with specific users as viewer or editor
- Editors can modify panels but cannot delete the dashboard or change permissions
- Viewers have read-only access
- Sharing a dashboard does not implicitly share its panels (panels inherit dashboard access)

## Architecture Context (from escalation answers)

### Auth system
Fully in place. `users` table (V6 migration), `user_sessions` table (V11 migration) with Bearer token + expiry. `AuthDirectives.scala` validates Bearer tokens via `UserSessionRepository.findValidSession`. Frontend `httpClient.ts` sends `Authorization: Bearer <token>` and has a 401 interceptor that clears auth and redirects to `/login`.

### ACL layer
`AclDirective.scala` already exists — resource-type-agnostic owner-only enforcement directive. Callers pass a resolver `(resourceId: String) => Future[Option[String]]` (returns the owner user ID). It returns 404 if not found, 403 if wrong owner, passes through if correct owner. This is wired in `ApiRoutes` per resource type.

### Owner columns
V10 migration added `owner_id` to dashboards. V14/V15 added `owner_id` to data sources and data types.

### What HEL-36 adds on top
- `resource_permissions` table (`resource_type`, `resource_id`, `grantee_id` nullable, `role` enum viewer|editor)
- `POST /api/dashboards/:id/permissions` — grant access
- `DELETE /api/dashboards/:id/permissions/:granteeId` — revoke
- `GET /api/dashboards/:id/permissions` — list (owner only)
- Extend `AclDirective` (or add alongside it) to check `resource_permissions` for non-owners: viewers get read-only, editors can modify panels but not delete dashboard or change permissions
- Public dashboards: accessible without auth when `grantee_id` IS NULL and `role = viewer`

### Enforcement rules
- Owners: full access
- Editors (via resource_permissions): can modify panels, cannot delete dashboard or change permissions
- Viewers (via resource_permissions): read-only
- Public (grantee_id IS NULL, role = viewer): read-only without auth
- DB-level enforcement (RLS): out of scope — application-level via AclDirective is the pattern

### User identity
From `AuthDirectives.authenticate` which provides `AuthenticatedUser` with `id: UserId`.
