## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Cited seams — all line/file citations checked against the actual worktree code, exact matches:**
- `AuthService.scala:84-88` — the `case Some(hash) if req.password.isBcryptedBounded(hash) =>` success
  branch (bcrypt compare → `buildSession` → `createSession` → `Right(authResultOf(...))`). Confirmed
  via `grep -n` read of the file.
- `AuthService.scala:107-113` — `completeOAuth(profile)` (upsert → `buildSession`/`createSession` →
  `authResultOf`). Confirmed.
- `OAuthRoutes.scala:125-135` — the `result = for {...}` chain through `onComplete(result) { case
  Success(authResult) => setCookie(...) { complete(...) } ... }`. Confirmed.
- `AuthRoutes.scala:52` — `login`'s `setCookie(SessionCookies.issue(result.token, cookieConfig))`.
  Confirmed (line 41 is `register`'s, line 52 is `login`'s, as design.md distinguishes).
- `ApiRoutes.scala:426` — `pathPrefix("auth") { concat(auth.routes, oauth.routes) }`, inside the
  *public* (`optionalAuthenticate`/pre-`authenticate`) branch of the three-way split. Confirmed this
  is the unauthenticated tree, distinct from the `authenticate` branch's own separate `pathPrefix("auth")`
  mounts at lines 436/438 (`logoutRoute`, `/me`) — i.e. the "some `/api/auth/*` public, some
  authenticated" pattern D5/D6 relies on for `/mfa/verify` vs `/mfa/enroll` is **already precedented**
  in this exact router, not a novel shape.
- `LoginPage.tsx:30-35` and `OAuthCallbackPage.tsx:29-35` — both are the exact
  fulfilled/rejected-branch bodies design.md D7 says will grow an `mfaRequired` branch. Confirmed.
- `SettingsPage.tsx:52-61` — the existing "Preferences"/"Agent memory" `<section>` pair inside
  `.settings-page__sections`; a third `<section>` appended there matches the file's existing pattern.
  Confirmed.
- `TokenHashing.scala` — `sha256Hex` is exactly the shared primitive design.md D2/D4 says backup-code
  and challenge-token hashing will reuse (already used by `api_tokens.token_hash` and
  `user_sessions.token_hash`). Confirmed.
- `AuthDirectives`'s `apiTokenRepo: Option[ApiTokenRepository] = None` defaulted-constructor-param
  precedent (line 17) — confirmed exact match for the pattern D3 proposes for `mfaService`.
- `requireCsrfHeader` (`AuthDirectives.scala:171-183`) — read the implementation: it only enforces the
  CSRF header when a `helio_session` cookie is present on a non-`GET` request (`optionalCookie(...).flatMap
  { case None => pass; ... }`). For `POST /api/auth/mfa/verify`, called pre-authentication with no
  cookie, this is provably a no-op — D5's "naturally inert" claim is accurate, not hand-waved.

**HEL-703 sibling-branch claims — verified against the real branch, not narrative:**
- `git diff main...feature/user-tier-chat-gating/HEL-703 --stat` confirms `V88__user_tier.sql` exists
  on that branch and `AuthService.scala` (34 lines), `ApiRoutes.scala` (26 lines) are modified there.
- Full diff of `AuthService.scala` on that branch confirms *exactly* what design.md claims: the login
  success branch is wrapped in `promoteIfAllowlisted(user).flatMap { promotedUser => ... }`,
  `completeOAuth`'s `upsertGoogleUser` call gains a `tierConfig` argument, and the constructor gains
  `tierConfig: UserTierConfig` (no default). The merge-recipe reasoning in D3 is grounded in this real
  diff, not invented.
- `git show .../HEL-703:.../V88__user_tier.sql` confirms the "`users` carries NO RLS ... pre-identity
  table" comment D2 cites as precedent genuinely exists verbatim on that branch.
- This worktree's own migration directory maxes at `V87__assistant_conversation_idempotency_key.sql` —
  confirms the ticket's "V88 looks free in this checkout" framing and justifies V89 (per the explicit
  dispatch constraint, not re-litigated here).

**Greenfield claims:** `grep` for `totp|TOTP|otpauth` across `backend/src`/`frontend/src`, and for
`commons-codec`/`qrcode` in `build.sbt`/`package.json`, all return nothing — D1's "zero existing TOTP
code" claim is accurate.

**Schema-file naming precedent:** `schemas/api-token.schema.json`, `create-api-token-{request,response}.schema.json`
exist, supporting task 2.1's "per api-token precedent" claim.

**AC → artifact tracing (all four covered, no gap):**
1. Enroll from Settings (QR, real-code confirm) → `totp-mfa-enrollment` spec (enrollment
   start/confirm) + `mfa-settings-ui` spec (enrollment flow) + tasks 1.3–1.10, 3.1, 3.6.
2. Both login paths gated on TOTP/backup code → `mfa-login-gate` spec + `email-password-auth`/
   `google-oauth-login` MODIFIED deltas + tasks 1.7, 1.9, 3.2–3.5.
3. Single-use backup codes for recovery → `totp-mfa-enrollment` (confirm/regenerate) +
   `mfa-login-gate` ("Verifying with a backup code" / "single-use" scenarios).
4. Disable with re-auth → `totp-mfa-enrollment`'s "Disable MFA with re-authentication" requirement +
   `mfa-settings-ui`'s disable flow.

**Spec-delta consistency:** diffed the delta files against the current canonical specs
(`openspec/specs/email-password-auth,google-oauth-login,google-oauth-callback-page,frontend-auth-ui/spec.md`).
Each MODIFIED requirement is additive (new MFA-branch clause + new scenario) with baseline scenarios
preserved verbatim; no requirement rewrite contradicts the baseline.

**Route-tree feasibility:** `ServiceResponse.runWith[A](result: Future[Either[ServiceError, A]])(success:
A => Route)` is generic (checked `ServiceResponse.scala:63`), so `login`/`completeOAuth` returning
`LoginOutcome` instead of `AuthResult` and branching inside the `success` callback type-checks against
the existing route-layer call pattern without further route-layer restructuring.

### Design-quality issues found (not required revisions — see below)

1. **Minor prose imprecision, D3:** "the ~9 positional `new AuthService(userRepo)` constructions
   across `GoogleOAuthRoutesSpec`/`ApiRoutesSpec` etc." overstates the actual shape — there is exactly
   one real construction site in `GoogleOAuthRoutesSpec` (a `makeAuthService()` helper reused ~9 times)
   plus one in `ApiRoutes.scala`'s production wiring; `ApiRoutesSpec` doesn't construct `AuthService`
   at all. The underlying conclusion (defaulted param ⇒ these call sites compile untouched) is still
   correct and verified — this is loose wording, not a wrong claim.
2. **`finishLogin`'s exact signature is underspecified**, D3: prose says `finishLogin(user):
   Future[LoginOutcome]`, and that the case body at 84-88 "becomes a single call `finishLogin(user)`."
   But the enclosing `login` method's match arms must type as `Future[Either[ServiceError,
   LoginOutcome]]` (mirroring today's `Future[Either[ServiceError, AuthResult]]`), so either
   `finishLogin` itself needs to return the `Either`-wrapped type, or the case body needs an extra
   `.map(Right(_))` around the "single call." This is a one-line type-signature detail a competent
   Scala implementer resolves trivially and doesn't change behavior or create two readable
   interpretations of what the feature does — not implementation-blocking.
3. **Production migration-ordering risk is documented only for the dev DB.** The Risks section covers
   "V88/V89 out-of-order on an already-migrated dev DB" (worst case: drop/recreate), but doesn't state
   the analogous production dependency: Flyway defaults to rejecting out-of-order migrations, so if
   V89 (this ticket) deploys to production before V88 (HEL-703) does, HEL-703's later deploy would fail
   validation until `outOfOrder` is set or V88 is renumbered. Both new tables are purely additive with
   no FK into any V88 table, so the failure mode is a loud deploy-time rejection, not silent
   corruption — but the design doesn't state the assumed landing order (V88 before V89) as a
   dependency the parent orchestrating session needs to hold, only the dev-DB mitigation.

None of the three rise to a required revision: (1) is a wording nit with a verified-correct
conclusion; (2) is a trivial Scala typing detail; (3) is an ops-risk gap whose blast radius is a loud
CI/deploy failure (not data loss) and whose root assumption — V88 lands before V89 — is exactly what
the ticket's own Dispatch Constraints establish as parent-session-managed context.

### Other checks
- No `TODO`/`TBD`/deferred-decision language found anywhere in proposal.md, design.md, tasks.md, or
  the eight spec deltas.
- No scope drift: enrollment/regenerate/status/disable endpoints and the frontend Settings section are
  all traceable to the ticket's explicit Description (not just the AC bullets), which names
  "view/regenerate backup codes" and a status affordance directly.
- Non-goals (WebAuthn, KMS-at-rest, tier-driven policy, broader rate-limiting) are explicit and
  consistent with the rest of the repo's current security posture (no rate-limiting infra exists
  anywhere else either).
- `/login/verify` route placement in `App.tsx` isn't pinned to an exact line, but the file already has
  a precedented "public route outside both `ProtectedRoute` and `PublicOnlyRoute`" shape at
  `/auth/callback` (line 583) for the implementer to follow — not a genuine ambiguity.

### Verdict: CONFIRM

### Non-blocking notes
1. Tighten D3's "~9 positional constructions... across `GoogleOAuthRoutesSpec`/`ApiRoutesSpec`" to
   accurately describe the single `makeAuthService()` helper in `GoogleOAuthRoutesSpec` (`ApiRoutesSpec`
   doesn't touch `AuthService` at all) — cosmetic, but worth fixing so the design doc doesn't
   overstate what it verified.
2. Pin down `finishLogin`'s exact return type (`Future[Either[ServiceError, LoginOutcome]]` vs.
   `Future[LoginOutcome]` + a `.map(Right(_))` at the call site) during task 1.7 so the "single call"
   framing and the HEL-703 merge recipe (`promoteIfAllowlisted(user).flatMap(finishLogin)`) compose
   cleanly without surprising the implementer mid-edit.
3. Consider adding one sentence to the Risks section stating the production-deploy-order dependency
   explicitly (V88/HEL-703 must land before V89/HEL-702, or `outOfOrder` must be reviewed) — currently
   only the dev-DB mitigation is spelled out.
