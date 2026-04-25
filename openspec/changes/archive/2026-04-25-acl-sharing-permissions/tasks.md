## 1. Backend — Database

- [x] 1.1 Write V16 Flyway migration: create `resource_permissions` table with `resource_type`, `resource_id`, `grantee_id` (nullable UUID), `role` CHECK constraint, partial unique index for null grantee, and regular unique index for non-null grantee
- [x] 1.2 Add `ResourcePermission` domain case class and `ResourceAccess` sealed trait (Owner | Editor | Viewer)

## 2. Backend — Repository

- [x] 2.1 Create `ResourcePermissionRepository` with `insert`, `delete`, `findByResource`, `findGrant(resourceId, userId)`, and `hasPublicViewerGrant(resourceId)` methods using Slick

## 3. Backend — ACL Directive

- [x] 3.1 Add `optionalAuthenticate` directive to `AuthDirectives` returning `Directive1[Option[AuthenticatedUser]]`
- [x] 3.2 Add `authorizeResourceWithSharing` to `AclDirective` that returns `ResourceAccess` (Owner/Editor/Viewer) to inner route, handles unauthenticated public access, and returns 404 for non-public unauthenticated requests

## 4. Backend — Permission Routes

- [x] 4.1 Create `PermissionRoutes` class handling `POST /api/dashboards/:id/permissions`, `DELETE /api/dashboards/:id/permissions/:granteeId`, `GET /api/dashboards/:id/permissions` (all owner-only)
- [x] 4.2 Add `GrantPermissionRequest`, `PermissionResponse`, `PermissionsResponse` case classes and JSON formatters in `JsonProtocols`

## 5. Backend — Dashboard Route Integration

- [x] 5.1 Update `GET /api/dashboards/:id/panels` in `DashboardRoutes` to use `authorizeResourceWithSharing`; allow Owner and Viewer+Editor (panel read); support unauthenticated public access
- [x] 5.2 Enforce editor-cannot-delete-dashboard: `DELETE /api/dashboards/:id` remains owner-only via `authorizeResourceWithSharing` checking `ResourceAccess == Owner`
- [x] 5.3 Enforce editor-cannot-patch-dashboard: `PATCH /api/dashboards/:id` remains owner-only
- [x] 5.4 Refactor public panel reads out from under `authenticate {}` in `ApiRoutes` using `optionalAuthenticate`

## 6. Backend — Panel Route Integration

- [x] 6.1 Update `PanelRoutes` PATCH/DELETE/duplicate panel routes to also accept Editor-level access by checking dashboard-level permissions for the panel's `dashboardId`
- [x] 6.2 Update `POST /api/panels` to require at least Editor-level access on the target dashboard

## 7. Backend — ApiRoutes Wiring

- [x] 7.1 Wire `PermissionRoutes` into `ApiRoutes` under `pathPrefix("dashboards")` with `authenticate` guard
- [x] 7.2 Pass `ResourcePermissionRepository` into `DashboardRoutes` and `PanelRoutes`

## 8. Tests

- [x] 8.1 Unit test `AclDirective.authorizeResourceWithSharing`: owner pass, editor pass, viewer pass, no-grant 403, unauthenticated public pass, unauthenticated non-public 404
- [x] 8.2 Integration test `PermissionRoutes`: grant, duplicate-409, revoke, list, non-owner-403
- [x] 8.3 Integration test public panel read: unauthenticated on public dashboard 200, unauthenticated on private 404
- [x] 8.4 Integration test editor access: editor can PATCH panel, editor cannot DELETE dashboard, viewer cannot PATCH panel
