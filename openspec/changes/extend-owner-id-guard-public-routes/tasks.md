## Standing Constraints

- [C1] Every guarded route's fixture data is owned by the distinctive `ownerId`, and the spec asserts that ownership (positive control) before guarding; an auth account is never created via register (random id).
- [C2] A mutation plants the owner-bearing entity's own id where the route holds one (login user, register conflict user, connector owner, upload owner, pipeline/output owner); the literal is allowed only where none is in scope; each mutation-*.txt states which kind.

## 1. Red

- [x] 1.1 Read PublicRouteOwnerIdLeakSpec, OwnerIdGuard, ApiRoutes.routes, PublicUploadRoutes, ConnectorCompletionRoutes/Service, AuthRoutes, OAuthRoutes, MfaRoutes.verifyRoute, HealthRoutes, and HEL-1852's AuthService/EmailNormalizer changes
- [x] 1.2 Seed the owner fixture per design D2 with positive controls
- [x] 1.3 ~~Write the structural coverage check~~ REMOVED: the source-scan structural check was dropped after review found escapes; it moves to HEL-1881. The red output and structural mutation evidence were removed with it.

## 2. Coverage

- [x] 2.1 Wire `/history` and `/insight` into the spec's PublicDashboardRoutes with seeded history points and an `ok` insight render; add the D3 cases with non-vacuous checks
- [x] 2.2 Add uploads/image cases (D3)
- [x] 2.3 Add connectors/completion GET and POST cases (D3)
- [x] 2.4 Add `/health`
- [x] 2.5 Add the `/api/auth/*` error-body cases (D3), including case-variant email
- [x] 2.6 Complete the coverage table; full spec green

## 3. Proof

- [x] 3.1 One mutation per new coverage point (plant owner id in that route's body in main code → red naming the route → revert); save each as `mutation-<route>.txt`
- [x] 3.2 ~~Structural mutations~~ REMOVED with the structural check (HEL-1881).
- [x] 3.3 Confirm `git diff` on backend/src/main is empty (or, if a real leak was found, the fix is minimal and reported as a security finding)
- [x] 3.4 Run related specs (PublicRouteOwnerIdLeakSpec, OwnerIdGuardSpec, plus any spec whose fixture was touched) and the backend gates; commit
