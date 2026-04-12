## 1. Domain Model

- [x] 1.1 Add `UserId` value class to `domain/package.scala` (or `model.scala`) alongside other ID wrappers
- [x] 1.2 Add `AuthenticatedUser(id: UserId)` case class to the domain model

## 2. Infrastructure — Session Repository

- [x] 2.1 Create `UserSessionRepository` trait with `findValidSession(token: String): Future[Option[AuthenticatedUser]]`
- [x] 2.2 Implement `SlickUserSessionRepository` that queries `user_sessions` where `token = ? AND expires_at > NOW()` and returns the user ID on a match
- [x] 2.3 Add `UserSessionRepository` to `JsonProtocols` implicit scope if any response types are needed (likely none — this is read-only infra)

## 3. Auth Directive

- [x] 3.1 Create `AuthDirectives` object (e.g., `api/AuthDirectives.scala`) that provides an `authenticate` directive
- [x] 3.2 Implement `authenticate` as a custom directive: extract `Authorization` header → parse `Bearer <token>` → call `userSessionRepo.findValidSession` → `provide(user)` on success or `complete(401, ErrorResponse("Unauthorized"))` on failure/missing
- [x] 3.3 Return `401` (not a rejection) so the error body is always the JSON error shape

## 4. Wire Authentication into Routes

- [x] 4.1 Add `UserSessionRepository` parameter to `ApiRoutes` constructor
- [x] 4.2 Instantiate `AuthDirectives` (or mix in) within `ApiRoutes`
- [x] 4.3 Wrap `dashboards.routes` and `panels.routes` with `authenticate { user => ... }` inside `pathPrefix("api")`
- [x] 4.4 Pass the `AuthenticatedUser` down to `DashboardRoutes` and `PanelRoutes` — either via constructor injection or by threading through the directive closure (prefer closure threading to avoid stateful constructors)
- [x] 4.5 Instantiate `SlickUserSessionRepository` in `Main.scala` / `HttpServer.scala` and pass it to `ApiRoutes`

## 5. Replace Hardcoded createdBy

- [x] 5.1 Update `DashboardRoutes` `POST /api/dashboards` handler to use `user.id.value` as `createdBy` instead of `"system"`
- [x] 5.2 Update `PanelRoutes` `POST /api/panels` handler to use `user.id.value` as `createdBy` instead of `"system"`

## 6. Tests

- [x] 6.1 Add a valid `Authorization: Bearer <token>` header fixture to `ApiRoutesSpec` (wire a stub/mock `UserSessionRepository` that returns a fixed `AuthenticatedUser`)
- [x] 6.2 Add test: `GET /api/dashboards` without `Authorization` returns `401`
- [x] 6.3 Add test: `POST /api/dashboards` without `Authorization` returns `401`
- [x] 6.4 Add test: `GET /api/dashboards/:id/panels` without `Authorization` returns `401`
- [x] 6.5 Add test: `POST /api/panels` without `Authorization` returns `401`
- [x] 6.6 Add test: request with expired/unknown token returns `401`
- [x] 6.7 Add test: `POST /api/dashboards` with valid token produces resource with `meta.createdBy` equal to the authenticated user ID
- [x] 6.8 Add test: `POST /api/panels` with valid token produces resource with `meta.createdBy` equal to the authenticated user ID
- [x] 6.9 Verify all existing protected-route tests pass with the auth header fixture added
