## Why

Once authentication is in place, the backend still allows any authenticated user to read or mutate any other user's dashboards and panels. ACL enforcement closes this gap by ensuring every sensitive route checks that the caller owns (or has been granted access to) the resource before executing.

## What Changes

- New Akka HTTP directive `authorizeResource(resourceType, resourceId, requiredRole)` that resolves the calling user (from the session token), looks up ownership and any permission grants, and rejects with `403` if the check fails.
- Applied to all `PATCH`, `DELETE`, and sensitive `GET` routes for dashboards and panels.
- Centralised registry of resource types so adding a new resource type is a one-liner registration — no duplication of ACL logic.
- Consistent `{"error": "Forbidden"}` response body on denial.

## Capabilities

### New Capabilities

- `acl-enforcement`: Akka HTTP directive and resource registry that enforce ownership-based access control on all sensitive routes, returning 403 on denial.

### Modified Capabilities

- `request-authentication`: The existing auth middleware is the prerequisite for ACL — the ACL layer runs after authentication resolves the user identity. No requirement changes to the auth spec itself; ACL is an additive layer on top.

## Impact

- Backend: new `AclDirective.scala` and `AclRegistry.scala`; changes to `ApiRoutes.scala` (or sub-routers) to wrap protected routes; new unit tests for the directive.
- No frontend changes required.
- No API contract shape changes — only new error responses (`403`) on routes that previously returned `200` or `404` for unauthorized callers.
- No new external dependencies.

## Non-goals

- Role-based sharing or collaborative permissions (ownership-only for now).
- Fine-grained field-level ACL.
- Audit logging of ACL denials.
