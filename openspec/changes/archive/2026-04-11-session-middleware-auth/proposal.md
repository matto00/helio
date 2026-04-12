## Why

All `/api/dashboards` and `/api/panels` routes are currently unprotected — any client can read or modify dashboards and panels without identifying themselves. HEL-33 added the register/login/logout endpoints and `user_sessions` table, creating the foundation for authentication; this change enforces that foundation at the routing layer so that only authenticated users can access protected resources, and resource authorship (`createdBy`) reflects the actual user.

## What Changes

- Add a custom Akka HTTP directive `authenticate` that extracts a Bearer token from the `Authorization` header, validates it against the `user_sessions` table (token exists and is not expired), and provides the resolved `AuthenticatedUser` to the route handler
- Unauthenticated or invalid requests to protected routes return `401 Unauthorized` with a JSON error body
- All existing route handlers (`DashboardRoutes`, `PanelRoutes`) are wrapped with `authenticate` so they receive the authenticated user
- Replace the hardcoded `createdBy = "system"` with the authenticated user's ID when creating new dashboards and panels
- Auth routes (`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`) remain public

## Capabilities

### New Capabilities

- `request-authentication`: Akka HTTP `authenticate` directive that validates Bearer tokens via the `user_sessions` table and injects `AuthenticatedUser` into the request context

### Modified Capabilities

- `resource-metadata`: `createdBy` on newly created dashboards and panels now reflects the authenticated user ID instead of the static string `"system"`

## Impact

- **Backend**: New `AuthDirective.scala` (or similar); `DashboardRoutes`, `PanelRoutes`, and `ApiRoutes` updated to require authentication; `UserSessionRepository` queried on every protected request
- **API contract**: All `/api/dashboards` and `/api/panels` endpoints now require `Authorization: Bearer <token>` header; missing/invalid tokens yield `401`
- **Frontend**: Must include the session token in all API requests (out of scope for this ticket — frontend integration follows)
- **No schema changes**: Response shapes are unchanged; `createdBy` values in responses will differ at runtime but the field type and presence are unaffected
