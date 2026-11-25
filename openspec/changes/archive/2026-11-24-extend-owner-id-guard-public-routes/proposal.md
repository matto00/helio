## Why

HEL-1216's `OwnerIdGuard` claims "every public route" is free of the owner's user id, but several routes reachable
without authentication were only code-read, never exercised: the image upload fetch, connector completion, the public
panel `/history` and `/insight` routes added after HEL-1216 (HEL-1273, HEL-1742), `/health`, and the anonymous error
bodies of `/api/auth/*`. A future owner-bearing field on any of them would ship unnoticed.

## What Changes

- A new sibling spec, `PublicRouteOwnerIdLeakApiSpec` (next to `PublicRouteOwnerIdLeakSpec`), makes anonymous (and share-token / stranger where meaningful) calls, each checked by
  `OwnerIdGuard`, for:
  - `GET /api/uploads/image/:id` (success bytes of an owner-uploaded image, unknown id 404, malformed id);
  - `GET` and `POST /api/connectors/completion` (missing, bad and refused tokens);
  - public panel `/history` and `/insight` (public, private no-token, wrong-token, nonexistent);
  - `/health`;
  - the ERROR bodies of `/api/auth/*`: login with a wrong password for the owner's email (and a case variant),
    duplicate register of that email (and a case variant), MFA verify with a bad challenge, OAuth callback with a
    bad/missing state. Success bodies are out (they return the caller's own id).
- A structural check that fails when a new unauthenticated route is added without coverage is NOT part of this change
  (a source-scan version was built and removed after review found escapes); it moves to HEL-1881.
- Mutation evidence: for each newly covered route, planting the owner id in its body turns the spec red.
- No route behaviour changes unless a test finds a real owner-id leak (then it is fixed and reported as a security
  finding).

## Capabilities

### New Capabilities

### Modified Capabilities
- `public-dashboards`: the "Every public route response is free of the owner's user id" requirement names the full
  unauthenticated route set.

## Impact

- Backend tests only: `backend/src/test/scala/com/helio/api/routes/dashboards/PublicRouteOwnerIdLeakSpec.scala`
  (possibly a small test-support helper). No main-code change expected, no migration, no frontend, no API change.

## Non-goals

- helio-mcp's OAuth endpoints (separate TypeScript service).
- Success bodies of register/login/OAuth (they legitimately carry the caller's own id).
- Rate limiting, CSRF or any other behaviour of these routes.
