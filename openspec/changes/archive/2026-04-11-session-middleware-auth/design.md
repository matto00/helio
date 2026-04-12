## Context

The backend currently has no authentication enforcement on its REST routes. HEL-33 added the infrastructure: a `users` table, a `user_sessions` table (with token, user ID, and expiry), and `register`/`login`/`logout` endpoints. The session token issued at login is a UUID stored server-side with an expiration timestamp.

All existing protected routes are defined in `DashboardRoutes` and `PanelRoutes`, both composed under `/api` in `ApiRoutes`. Route handlers currently create resources with `createdBy = "system"` because no user identity is available.

## Goals / Non-Goals

**Goals:**
- Validate Bearer tokens on every protected route before the handler executes
- Reject unauthenticated requests with `401 Unauthorized` and a JSON error body
- Provide the resolved `AuthenticatedUser` (user ID at minimum) to all route handlers
- Use the authenticated user's ID as `createdBy` when creating new dashboards and panels

**Non-Goals:**
- Role-based access control or per-resource ownership enforcement (future scope)
- Frontend session management or token storage (follows in a separate ticket)
- Token refresh / sliding expiration
- Rate limiting or brute-force protection on auth routes

## Decisions

### D1: Custom Akka HTTP directive over a middleware layer

**Decision**: Implement authentication as a custom Akka HTTP directive (`authenticate`) that returns the `AuthenticatedUser` value to its inner route via `provide`.

**Rationale**: Akka HTTP directives compose naturally with the existing route DSL. A directive keeps authentication close to the routing layer, avoids any actor messaging overhead, and lets individual routes opt out (e.g., health check, auth endpoints). A global middleware layer would require intercepting all requests and threading context through a different mechanism.

**Alternative considered**: A `RequestTransformer` / `mapRequest` approach — rejected because it cannot short-circuit with a rejection/response without breaking the route tree composition model.

### D2: Synchronous DB lookup per request (no in-memory token cache)

**Decision**: Validate the token with a direct database query on each protected request rather than caching valid tokens in memory.

**Rationale**: The existing infrastructure layer uses Slick/Future-based queries. Introducing an in-memory cache adds complexity (cache invalidation on logout, TTL management) that is not warranted at this stage. A single indexed lookup on `user_sessions` by token is fast enough for current load.

**Alternative considered**: An in-memory `ConcurrentHashMap` cache — deferred; can be added as an optimization later without changing the directive's external contract.

### D3: Inject `AuthenticatedUser` as a case class (not just a user ID string)

**Decision**: Define `final case class AuthenticatedUser(id: UserId)` and pass it through the directive rather than a raw String.

**Rationale**: A typed wrapper is more idiomatic Scala, makes route handler signatures self-documenting, and allows adding fields (e.g., email, roles) later without changing the directive signature.

### D4: `UserSessionRepository` in the infrastructure layer

**Decision**: Add a `UserSessionRepository` trait with a `findValidSession(token: String): Future[Option[AuthenticatedUser]]` method, backed by Slick.

**Rationale**: Keeps the directive itself free of SQL and consistent with the existing repository pattern used for dashboards, panels, etc.

## Risks / Trade-offs

- **Per-request DB hit**: Every protected API call queries `user_sessions`. At low scale this is fine; at scale, a caching layer will be needed. → Mitigation: use a covering index on `(token, expires_at)` so the query is a fast index scan.
- **Token not invalidated on server restart**: Sessions survive restarts because they're persisted in Postgres. This is intentional but means a leaked token stays valid until expiry. → Mitigation: expiry window enforced in DB query.
- **`createdBy` migration**: Existing resources have `createdBy = "system"`. No migration is performed; historical data retains that value. → Acceptable for now; a backfill can be done when multi-tenancy is fully enforced.

## Migration Plan

1. Add `UserSessionRepository` and `AuthenticatedUser` to the infrastructure / domain layers.
2. Wire `UserSessionRepository` into `ApiRoutes` (constructor injection, consistent with existing repos).
3. Implement the `authenticate` directive in a new `AuthDirectives` object.
4. Wrap `dashboards.routes` and `panels.routes` with `authenticate { user => ... }` in `ApiRoutes`.
5. Update `DashboardRoutes` and `PanelRoutes` constructors to accept `AuthenticatedUser` (or thread it through the directive closure — see tasks).
6. Replace `createdBy = "system"` with `createdBy = user.id.value` at creation sites.
7. Update `ApiRoutesSpec` to include a valid `Authorization` header on all protected route tests; add new tests for the `401` cases.

**Rollback**: Revert to prior routes without the authenticate wrapper. No schema changes are involved, so rollback is a pure code revert.

## Open Questions

- None — all decisions above are self-approved for this scope.
