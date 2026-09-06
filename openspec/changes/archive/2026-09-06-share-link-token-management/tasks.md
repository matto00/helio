## 1. Backend — persistence

### Backend

- [x] 1.1 Re-derive the next Flyway version from `backend/src/main/resources/db/migration/` (planned V101) and write `VNNN__share_tokens.sql` creating `share_tokens` (id, dashboard_id, user_id, token_hash unique, expires_at nullable, revoked_at nullable, created_at) with `ENABLE`/`FORCE ROW LEVEL SECURITY` and the owner-only policy per the V92 idiom; verify `sbt run` boots and Flyway reports the migration applied
- [x] 1.2 Add the unique index on `token_hash` and an index on `(dashboard_id)` in the same migration; verify via `\d share_tokens` that both exist
- [x] 1.3 Add `ShareTokenRepository` + row case class + Slick table under `backend/src/main/scala/com/helio/infrastructure/persistence/sharing/`, following `ResourcePermissionRepository`'s file shape, with `insert`, `findByDashboard`, `findActiveByHash`, `revoke`; verify it compiles via `sbt compile`
- [x] 1.4 Assign pools per design D6 — `insert`, `findByDashboard`, `revoke` through `ctx.withUserContext(userId)` so the RLS policy is exercised by shipped code, and only `findActiveByHash` through `ctx.withSystemContext` with the mandatory inline justification comment; verify by grep that the file contains no raw `db.run` and that exactly one method uses `withSystemContext`

## 2. Backend — domain and service

### Backend

- [x] 2.1 Add the `ShareToken` domain model with a `ShareTokenId` value-class wrapper, following the existing ID-wrapper convention; verify `sbt compile`
- [x] 2.2 Implement token generation in the service using `java.security.SecureRandom`, 32 bytes, base64url unpadded, with the imports at the top of the file (no inline FQNs); verify `npm run check:scala-quality` passes
- [x] 2.3 Implement SHA-256 hashing of the token for storage and lookup so the plaintext is never persisted; verify no code path writes the raw token to the database
- [x] 2.4 Implement `ShareTokenService` create/list/revoke, each gated by `accessChecker.requireOwnerOnly("dashboard", dashboardId, user, "Dashboard not found")`, returning `Either[ServiceError, A]` per the `PermissionService` template; verify `sbt compile`
- [x] 2.5 Implement `ShareTokenValidator.authorizes(resourceType, resourceId, token)` returning a single `Future[Boolean]` for all failure modes — unknown hash, revoked, expired, wrong resource — with one query and in-memory state checks per design D4; verify by inspection both that there is exactly one `false` exit shape and that every failure mode is reached by the same single indexed lookup with no extra query on any path, which is what the specs' cost-parity scenario rests on
- [x] 2.6 Reject a creation request whose expiry is at or before now with a validation `ServiceError`; verify `sbt compile`

## 3. Backend — HTTP wiring

### Backend

- [x] 3.1 Add `ShareTokenProtocol` under `com.helio.api.protocols` with request/response case classes and `jsonFormatN` values, and mix it into `JsonProtocols`; verify `sbt compile`
- [x] 3.2 Add `ShareTokenRoutes` (create/list/revoke) under `com.helio.api.routes.dashboards`, completing via `ServiceResponse.run`; verify `sbt compile`
- [x] 3.3 Wire `ShareTokenRoutes` into the `authDirectives.authenticate` branch of `ApiRoutes.scala` and construct the repo/service/validator alongside the existing wiring; verify the routes respond under `sbt run`
- [x] 3.4 Extend `AclDirective` with a `shareTokenValidator` constructor dependency and a trailing `shareToken: Option[String] = None` parameter on `authorizeResourceWithSharing`, consulting the token on BOTH denial arms — the authenticated-no-grant 403 arm and the anonymous-no-public-grant 404 arm — never only the anonymous one, and never downgrading an Owner or Editor already resolved; verify the two existing call sites compile unchanged
- [x] 3.5 Ensure an invalid token completes exactly the denial its arm would have produced with no token at all, introducing no new denial shape; verify by inspection that the token path adds no `complete(...)` call of its own
- [x] 3.6 Thread an optional `token` query parameter through `PublicDashboardRoutes`' two routes into `authorizeResourceWithSharing`; verify a valid token returns panels anonymously under `sbt run`

## 4. Contract

### Backend

- [x] 4.1 Add `schemas/dashboards/create-share-token-request.schema.json`, `share-token.schema.json`, and `create-share-token-response.schema.json` — the create response carrying the token secret but NO fully-qualified URL, which the client composes — with each `title` matching its Scala case class name and 1:1 property names; verify `npm run check:schemas` passes
- [x] 4.2 Confirm the spec deltas under `openspec/changes/share-link-token-management/specs/` describe the shipped routes and statuses accurately; verify `openspec validate share-link-token-management --type change` exits zero and `npm run check:openspec` passes

## 5. Frontend

### Frontend

- [x] 5.1 Add `shareTokenService.ts` under `frontend/src/features/dashboards/services/` with typed `httpClient` calls for create/list/revoke; verify `npm run typecheck`
- [x] 5.2 Add `shareTokensSlice.ts` with `createAsyncThunk` thunks per operation following the `dashboardsSlice` idiom, and register its reducer in `frontend/src/store/store.ts`; verify `npm run typecheck`
- [x] 5.3 Build `DashboardShareDialog.tsx` on the shared `Modal`, with a create-link form including an optional expiry, a list of existing tokens, and a co-located `DashboardShareDialog.css` using only `--space-*`/colour/radius tokens; verify `npm run lint` passes with zero warnings
- [x] 5.4 Compose the share URL client-side from `window.location.origin` plus the returned token, show the minted secret exactly once with a copy control using `navigator.clipboard` in try/catch and a `Toast` on both outcomes, plus explicit copy that the link cannot be shown again; verify manually in the dev server
- [x] 5.5 Render each token's state as a `StatusChip` (Active/Expired/Revoked) with a text label so colour is never the sole carrier of meaning; verify against DESIGN.md §7
- [x] 5.6 Gate revoke behind `ConfirmInline` with the Danger style on the final confirm, never `window.confirm`; verify by grep that `window.confirm` is absent
- [x] 5.7 Handle loading, empty (`EmptyState`), and error states explicitly, and open the dialog from the dashboard's existing actions affordance; verify all three states render in the dev server
- [x] 5.8 Verify keyboard operability, focus return to the invoking control on dismissal, 44px touch targets, and layout at the 430px breakpoint; verify in the dev server at each breakpoint

## 6. Tests

### Tests

- [x] 6.1 Add a `ShareTokenServiceSpec` covering create with and without expiry, past-expiry rejection, list omitting secrets, revoke, and idempotent double-revoke; verify `sbt "testOnly *ShareTokenServiceSpec"`
- [x] 6.2 Add a validator spec asserting a valid token authorizes and that unknown, revoked, expired, and wrong-resource tokens each return the same negative result; verify `sbt "testOnly *ShareTokenValidatorSpec"`
- [x] 6.3 Add a route-level spec asserting an anonymous request with a valid token returns panels, and that all six of — expired token, revoked token, nonexistent token, wrong-resource token, no token at all on the same private dashboard, and any request against a dashboard id that does not exist — return byte-identical status and body, asserted by comparing the six responses to each other rather than to a hardcoded literal; verify `sbt "testOnly *ShareTokenPublicAccessSpec"`
- [x] 6.4 Add a spec asserting an authenticated non-grantee presenting a valid token receives panels rather than 403, and that an owner and an editor grantee are not downgraded to Viewer when a token is also present; verify `sbt "testOnly *ShareTokenAuthenticatedAccessSpec"`
- [x] 6.5 Add an owner-only spec asserting an editor grantee, a viewer grantee, an unrelated user, and an anonymous caller are each refused create/list/revoke, and that a non-owner cannot distinguish an existing dashboard from an absent one; verify `sbt "testOnly *ShareTokenOwnershipSpec"`
- [x] 6.6 Add an entropy/generation spec asserting tokens are unique across many mints, are not prefixed by or derived from the dashboard id, and decode to at least 16 bytes, plus a grep assertion that the token path contains no `scala.util.Random` or `Math.random` — statistical uniqueness alone cannot distinguish a CSPRNG from a general-purpose PRNG; verify `sbt "testOnly *ShareTokenGenerationSpec"`
- [x] 6.7 Add an RLS spec constructing two genuinely distinct pools (never `DbContext(db, db)`) asserting one owner's app-pool connection cannot read another owner's `share_tokens` row, including a fixture-liveness assertion that the app pool positively reads its own row so an empty result cannot pass vacuously; verify `sbt "testOnly *ShareTokenRlsSpec"`
- [x] 6.8 Confirm each new backend assertion can actually fail: mutate the validator to ignore `revoked_at`, then to ignore `expires_at`, then to skip the resource binding, recording for each the NAMED test that turns red — a mutation that reddens many tests at once demonstrates nothing about which test discriminates
- [x] 6.9 Add a fourth mutation on the opposite axis, since the three above all fail permissively and none can ever redden the indistinguishability check: give one failure mode a distinct exit (make the revoked arm complete a different message or a 403) and record that task 6.3 SPECIFICALLY turns red on it; if 6.3 stays green, it is evidence-shaped non-evidence and must be strengthened until it fires
- [x] 6.10 Add `DashboardShareDialog.test.tsx` covering mint-and-copy with a mocked `navigator.clipboard`, the shown-once notice, revoke behind confirmation, the empty state, and a failed revoke surfacing an error; verify `npm test -- --testPathPattern=DashboardShareDialog`
- [x] 6.11 Add `shareTokensSlice.test.ts` covering the fulfilled and rejected reducers per thunk; verify `npm test -- --testPathPattern=shareTokensSlice`
- [x] 6.12 Run the full gate chain — `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run check:schemas`, `npm run check:openspec`, `npm run check:scala-quality`, `npm test`, and `sbt test` — and verify all pass
