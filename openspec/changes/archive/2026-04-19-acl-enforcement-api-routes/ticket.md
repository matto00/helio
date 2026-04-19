# HEL-37: ACL enforcement in API routes

## Summary

Apply ACL checks consistently across all dashboard and panel API endpoints.

## Scope

- Akka HTTP directive: `authorizeResource(resourceType, resourceId, requiredRole)` — checks ownership + permission grants
- Apply to all `PATCH`, `DELETE`, and sensitive `GET` routes
- Centralise ACL logic so it is reusable for future resource types
- Return `403` with a consistent error body on denial

## Acceptance criteria

- No route bypasses ACL checks
- ACL directive is unit-tested independently of route handlers
- Adding a new resource type only requires registering it — no copy-paste of auth logic
