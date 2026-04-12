## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS

Issues:
- none

**Details:**

All Linear ticket acceptance criteria are explicitly addressed:

1. **New Google users are automatically registered on first login** — `upsertGoogleUser` creates a new user record with `google_id` when none exists (lines 75–94 of UserRepository.scala). Tests confirm this in "should return 200 with AuthResponse for a new Google user" (GoogleOAuthRoutesSpec:158).

2. **Returning Google users are matched by google_id (not email)** — `findByGoogleId` retrieves users by the `google_id` field (line 43–45 of UserRepository.scala). Upsert logic matches on `google_id` (line 66 of UserRepository.scala). Tests confirm no duplicate records are created on second login (GoogleOAuthRoutesSpec:187–233).

3. **Callback errors (denied, invalid state) return clear redirects or error responses** — The callback handler returns `400 Bad Request` with descriptive error messages for `error=access_denied` (test line 110), other error codes (test line 127), and invalid state (test line 138–152). Failures on token exchange return `502 Bad Gateway` (test line 255).

All tasks in `tasks.md` are marked `[x]` and implemented:
- Database migration (V8__google_oauth.sql) adds google_id and avatar_url with partial unique index
- Domain model (`User` case class) includes `googleId` and `avatarUrl` fields
- Configuration loading in Main.scala with fail-fast on missing env vars
- Repository layer methods `findByGoogleId` and `upsertGoogleUser`
- Google OAuth routes in AuthRoutes.scala with all required endpoints
- Error handling for all specified scenarios (access denied, token exchange failure, missing code/state)
- JSON serialization for GoogleProfile and UserResponse
- Comprehensive ScalaTest suite covering happy path, error cases, and idempotence

No scope creep detected. The implementation is narrowly focused on backend Google OAuth2 only — no frontend changes, no account linking, no PKCE state parameter (explicitly noted as non-goal).

API contracts properly updated:
- Spec created: `google-oauth-login/spec.md` defining both new routes and their exact behavior
- Spec updated: `email-password-auth/spec.md` documents that `UserResponse` now includes `avatarUrl` field
- Both specs are comprehensive and match the implementation exactly

### Phase 2: Code Review — PASS

Issues:
- none

**Details:**

**DRY & Reusability:**
- Session creation logic (`createSession`) is properly extracted and shared between email/password and Google OAuth flows (AuthRoutes.scala:67–76)
- Google HTTP exchange/profile fetch are protected methods (`exchangeCodeForTokenImpl`, `fetchGoogleProfileImpl`) designed to be overridable for testing — excellent test design
- Password hashing (bcrypt) and hashing verification logic remains unchanged and shared with email/password path

**Readable & Self-evident:**
- Clear variable naming: `exchangeCodeForTokenImpl`, `fetchGoogleProfileImpl`, `validateCsrfState`, `upsertGoogleUser`
- Magic CSRF state TTL (300 seconds = 5 minutes) is named as a constant with comment
- Sentinel placeholder email (`google:<google_id>@helio.invalid`) is documented in design.md and evident in code
- No unexplained magic numbers; token generation uses `SecureRandom` with explicit 32-byte seed

**Modular & Separation of Concerns:**
- AuthRoutes handles HTTP routing and orchestration
- UserRepository handles database operations (find, insert, upsert)
- JsonProtocols handles serialization/deserialization
- Main.scala handles environment variable loading and dependency injection
- GoogleProfile case class cleanly separates Google API response shape

**Type Safety:**
- No `any` used anywhere
- `Option[String]` correctly used for nullable Google profile fields (`email`, `name`, `picture`)
- `Future` types are explicit throughout async flows
- Scala case classes and type-safe wrappers (`UserId`, etc.) enforced

**Security:**
- CSRF state validation implemented: state is generated, stored with expiry, and validated on callback (lines 49–60, 278–280 of AuthRoutes.scala)
- State parameter is now **required** in the callback, protecting against CSRF attacks
- No plaintext secrets logged
- Secure random generation: `SecureRandom` used for both token and state generation
- State expiry enforced (5 minutes) with cleanup on validation
- Timing attack prevention: dummy bcrypt hash comparison for unknown emails (shared with login path — no regression)
- Input validated via `RequestValidation` for register/login (unchanged paths still protected)
- Akka HTTP client timeouts configured (default Akka HTTP timeout applies — acceptable for Google API calls)

**Error Handling:**
- System boundaries (HTTP requests to Google) properly handled: failures convert to `Future.failed` then caught by `onComplete` block
- Explicit error response messages distinguish between token exchange failure, access denied, and state validation failure
- No silently swallowed exceptions; all errors return HTTP responses with clear status codes and messages
- Token exchange errors (400, 502) explicitly detected and mapped (lines 309–314 of AuthRoutes.scala)

**Tests are Meaningful:**
- Happy path: new user creation verified with assertions on token, user ID, avatar (lines 158–184)
- Idempotence: second login with same google_id returns same user ID, no duplicate (lines 187–232)
- Database assertions: `SELECT COUNT(*) FROM users WHERE google_id = 'google-sub-002'` confirms exactly one record
- Error paths: access denied, invalid state, token exchange failure all tested with expected status codes and messages
- CSRF protection: state validation tested for missing (line 138) and invalid (line 149) states
- Regression: existing email/password tests still pass (AuthRoutesSpec output shows all 167 tests pass)

**No Dead Code:**
- All imports are used
- All methods are called
- No unused variables (spot check: all loop variables and bindings are referenced)
- No TODO/FIXME comments left behind

**No Over-engineering:**
- In-memory CSRF state store with expiry is appropriate for single-instance dev/MVP — clear mitigation noted in design.md for production
- Direct Akka HTTP client calls for Google OAuth (no library) keeps dependency footprint minimal
- No hypothetical "future" code (e.g., account linking, PKCE) included

### Phase 3: UI Review — N/A

**Reason:** No frontend files were modified. This change is backend-only (Google OAuth2 server-side implementation). Frontend integration (HEL-38, Google OAuth login UI) is explicitly out of scope for this ticket. The two public routes (`GET /api/auth/google`, `GET /api/auth/google/callback`) are fully functional and can be integrated by a frontend team separately.

### Overall: PASS

All three phases clear. The implementation is complete, well-tested, secure, and ready for merge.

### Change Requests

None.

### Non-blocking Suggestions

- **State store scalability** (minor, noted in design): For production, the in-memory CSRF state store should be replaced with a distributed session store (Redis, database) to survive restarts and scale across multiple instances. This is already documented as acceptable for current scope.
- **Google profile scope verification** (minor): The code requests `scope=openid email profile` but doesn't validate that Google's response includes all requested fields. The implementation gracefully handles missing `email` with a placeholder, which is good. Consider adding a comment if `name` becomes required in future.
