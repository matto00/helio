## Context

Authentication is already in place: `AuthDirectives.authenticate` resolves an `AuthenticatedUser` from the bearer token and injects it into all protected routes via `ApiRoutes.scala`. However, nothing yet checks whether the authenticated user *owns* the dashboard or panel they are acting on. Any valid session can mutate any other user's resources.

The route classes (`DashboardRoutes`, `PanelRoutes`) already receive `AuthenticatedUser` as a constructor parameter and store `createdBy` via `ResourceMeta` in the database. The missing piece is a directive that compares `user.id` with `resource.meta.createdBy` before executing the handler.

## Goals / Non-Goals

**Goals:**
- Enforce ownership checks on all PATCH, DELETE, and sensitive GET routes for dashboards and panels
- Provide a reusable `AclDirective` that lives alongside `AuthDirectives`
- Return `403 {"error": "Forbidden"}` on denial, consistently
- Unit-test the directive independently of route handlers

**Non-Goals:**
- Shared/collaborative permissions (other users granting access)
- ACL enforcement on data-types or data-sources (no per-user ownership model yet)
- Database-backed permission grants table

## Decisions

### Decision: Ownership check via repository lookup, not embedded in route handlers

Each route that requires ACL calls an `authorizeResource` directive that accepts a resource type and ID. The directive fetches the resource's `createdBy` from the repository and compares it against `user.id`. The route handler only executes if the check passes.

Alternative: embed the check inline in every route handler. Rejected — copy-paste guarantees drift. The directive approach centralises the logic and makes it impossible to add a new route without opting in.

### Decision: AclDirective takes a typed resolver function, not a registry object

Rather than a mutable registry, `AclDirective` is constructed with a `Map[ResourceType, (String, UserId) => Future[Option[String]]]` — each entry is a function that takes `(resourceId, userId)` and returns `Future[Option[String]]` where `Some(ownerId)` means found and `None` means not found (→ 404). The directive compares the returned owner ID with `user.id`.

This keeps the ACL logic pure and easily testable with mocked resolver functions. Registering a new resource type is a single map entry at construction time in `ApiRoutes.scala`.

### Decision: 404 when resource is not found, 403 when found but not owned

This matches standard REST semantics and avoids leaking the existence of resources owned by other users (404 is returned regardless of whether the resource exists or belongs to another user). The directive returns 403 only when the resource is confirmed to exist but the caller is not the owner.

Wait — for simplicity and security, the preferred approach is: if the resource does not exist OR is owned by someone else, return 404 (not 403). This prevents resource enumeration. The directive returns 403 only on explicit ownership mismatch after confirming existence. For this implementation: return 403 when resource exists and owner differs; return 404 when resource does not exist.

### Decision: Apply ACL at the route level, not repository level

Repositories remain unaware of the calling user. This keeps infrastructure clean and testable, and allows queries like `dashboardRepo.findAll()` (which returns all dashboards; owner filtering will be scoped separately in a future multi-tenant ticket).

## Risks / Trade-offs

- [Risk] `findAll` still returns all dashboards for any user → Mitigation: noted as follow-up; this ticket scopes to mutation and sensitive single-resource GET routes only.
- [Risk] An extra repository lookup per ACL-checked request → Mitigation: negligible for current scale; connection pool (HikariCP) absorbs it.

## Migration Plan

No schema changes. No frontend changes. Deploy as a regular backend release. Rollback: revert the `ApiRoutes.scala` wiring changes.

## Planner Notes

Self-approved: additive backend change, no breaking API shape changes, no new external dependencies, no schema migrations. The `AuthenticatedUser` injection pattern already exists so the ACL layer slots in cleanly.
