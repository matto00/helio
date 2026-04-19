## 1. Backend

- [x] 1.1 Create `AclDirective.scala` in `com.helio.api` with `authorizeResource(resourceType, resourceId, user, resolver)` directive
- [x] 1.2 Define `ResourceType` sealed trait (`Dashboard`, `Panel`) in `com.helio.domain`
- [x] 1.3 Wire ACL resolvers into `ApiRoutes.scala`: dashboard resolver calls `dashboardRepo.findById`, panel resolver calls `panelRepo.findById`
- [x] 1.4 Apply `authorizeResource` to `PATCH /api/dashboards/:id` in `DashboardRoutes`
- [x] 1.5 Apply `authorizeResource` to `DELETE /api/dashboards/:id` in `DashboardRoutes`
- [x] 1.6 Apply `authorizeResource` to `GET /api/dashboards/:id/panels` in `DashboardRoutes`
- [x] 1.7 Apply `authorizeResource` to `GET /api/dashboards/:id/export` in `DashboardRoutes`
- [x] 1.8 Apply `authorizeResource` to `POST /api/dashboards/:id/duplicate` in `DashboardRoutes`
- [x] 1.9 Apply `authorizeResource` to `PATCH /api/panels/:id` in `PanelRoutes`
- [x] 1.10 Apply `authorizeResource` to `DELETE /api/panels/:id` in `PanelRoutes`
- [x] 1.11 Apply `authorizeResource` to `POST /api/panels/:id/duplicate` in `PanelRoutes`
- [x] 1.12 Add `{"error": "Forbidden"}` to `JsonProtocols` / ensure `ErrorResponse` format covers 403 body

## 2. Tests

- [x] 2.1 Write `AclDirectiveSpec` unit tests: owner resolver → inner route executes
- [x] 2.2 Write `AclDirectiveSpec` unit tests: non-owner resolver → 403 Forbidden
- [x] 2.3 Write `AclDirectiveSpec` unit tests: missing resource resolver → 404 Not Found
- [x] 2.4 Write route-level tests for `DashboardRoutes` covering ACL on PATCH and DELETE
- [x] 2.5 Write route-level tests for `PanelRoutes` covering ACL on PATCH and DELETE
