# Design: add-totp-mfa (HEL-702)

## Context

Both primary auth paths converge on `userRepo.createSession` inside `AuthService`
(`backend/src/main/scala/com/helio/services/AuthService.scala`): password login at lines 84–88 (bcrypt compare →
`buildSession` → `createSession`), OAuth at 107–113 (`completeOAuth`, called from `OAuthRoutes.scala:125-135`). The
HTTP-level session step is `setCookie(SessionCookies.issue(...))` (`AuthRoutes.scala:52`, `OAuthRoutes.scala:133`);
response bodies never carry the token (HEL-287). Sessions live in `user_sessions` storing `TokenHashing.sha256Hex`
of a 32-byte `SecureRandom` token. There is no MFA/TOTP/base32/HMAC code anywhere in the repo (grep-confirmed) —
this is greenfield. **Parallel constraint:** HEL-703 (unmerged) modifies the same `AuthService.login` success branch
(wraps it in `promoteIfAllowlisted(...).flatMap`), the same `completeOAuth` upsert line, the `AuthService`
constructor, and has claimed migration **V88** on its branch — a real merge conflict is expected and planned for,
per dispatch.

## Goals / Non-Goals

Goals: per-user opt-in TOTP (RFC 6238) gating session establishment on both auth paths; enrollment with QR +
confirm; single-use backup codes; disable with re-auth; minimal, mechanically-resolvable conflict surface vs
HEL-703. Non-goals: see proposal (no WebAuthn/SMS, no KMS encryption at rest, no policy enforcement, no global
login throttling).

## Decisions

### D1 — TOTP library: `com.eatthepath:java-otp:0.4.0` + `commons-codec` Base32; QR rendered client-side

`java-otp` (Jon Chambers) does the one cryptographically-sensitive piece — RFC 6238 code generation over
`javax.crypto.Mac` — with **zero transitive dependencies** and active maintenance. We add `commons-codec` (Apache,
ubiquitous) for RFC 4648 Base32 (JDK has Base64 only), build the `otpauth://` URI as a plain string, and verify
with an explicit ±1-step window loop (D5). Rejected: `dev.samstevens.totp` (bundles zxing image-generation into the
server for a QR we render client-side; last release 2020); hand-rolling RFC 6238 (avoidable crypto surface; the
window/replay logic we do own is testable against RFC 6238 Appendix B vectors). Frontend QR: add `qrcode.react`
(no QR lib exists in `package.json`) rendering the otpauth URI as SVG — the secret transits the enroll response
regardless (manual-entry key is a ticket requirement), so client-side rendering adds no exposure.
Secrets are 20 random bytes (RFC 4226 §4) from a shared `SecureRandom` (precedent: `AuthService.scala:153`).

### D2 — Data model: migration **V89** (not V88), three tables, no RLS

V88 is claimed by HEL-703's unmerged branch (`V88__user_tier.sql`, verified via `git diff main...` on its branch) —
a "highest number in checkout" check is wrong here by explicit dispatch instruction. `V89__totp_mfa.sql`:

- `user_mfa`: `user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`, `totp_secret TEXT NOT NULL`
  (Base32), `enabled BOOLEAN NOT NULL DEFAULT FALSE`, `last_used_step BIGINT NOT NULL DEFAULT 0` (D5 replay guard),
  `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `verified_at TIMESTAMPTZ NULL`.
- `mfa_backup_codes`: `id UUID PK DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES users(id) ON
  DELETE CASCADE`, `code_hash TEXT NOT NULL`, `used_at TIMESTAMPTZ NULL`, `created_at`. Separate rows (not an
  array column) make single-use consumption one `UPDATE … WHERE used_at IS NULL` and "codes remaining" one count.
- `mfa_login_challenges`: `id UUID PK`, `user_id FK CASCADE`, `token_hash TEXT UNIQUE NOT NULL`, `attempts INT
  NOT NULL DEFAULT 0`, `created_at`, `expires_at TIMESTAMPTZ NOT NULL`. Mirrors `user_sessions`' token pattern.

**No RLS** on any of the three: all are read pre-identity on the login path, exactly like `users`/`user_sessions`
(the V88 comment documents this precedent; `ApiTokenRepository.findUserByTokenHash` is the documented privileged
pre-auth lookup). `MfaRepository` takes the raw Slick `Database` like `UserRepository` does. Hashing: backup codes
and challenge tokens are high-entropy random (50+ bits), so `TokenHashing.sha256Hex` (house pattern for exactly
this) — not bcrypt, which buys nothing against random tokens and would make verify scan N slow hashes. The TOTP
secret itself must be recoverable for verification, so it is stored as-is (KMS encryption: non-goal).

### D3 — Gate shape: sealed `LoginOutcome`, one-call-site hunks, defaulted constructor param

`AuthService` gains `mfaService: Option[MfaService] = None` (precedent: `AuthDirectives`' defaulted
`apiTokenRepo: Option[ApiTokenRepository] = None`). `None` = feature absent = today's behavior, so the ~9
positional `new AuthService(userRepo)` constructions across `GoogleOAuthRoutesSpec`/`ApiRoutesSpec` etc. compile
untouched — which also keeps those call sites out of the HEL-703 conflict (their branch adds a `tierConfig` param).

New sealed outcome, returned by both paths:
`sealed trait LoginOutcome`; `SessionEstablished(result: AuthResult)`; `MfaRequired(challengeToken: String)`.
The password-login success branch body (`AuthService.scala:84-88`) becomes a **single call** `finishLogin(user)`;
`completeOAuth`'s session lines (109–112) likewise. `finishLogin(user): Future[LoginOutcome]` is a new private
method appended at the file bottom: MFA enabled → create a challenge, return `MfaRequired`; else mint the session
as today. **HEL-703 merge recipe** (both sides restructure the same lines): password branch resolves to
`promoteIfAllowlisted(user).flatMap(finishLogin)`; `completeOAuth` takes both line-edits (their `upsertGoogleUser`
arg + our `finishLogin`); constructor takes both params. Routes branch on the outcome: `SessionEstablished` →
`setCookie` exactly as today; `MfaRequired` → 200 `{ "mfaRequired": true, "challengeToken": "…" }` with **no
cookie and no user object** (a password thief must not learn profile data pre-second-factor). `register` is
untouched (a fresh account cannot have MFA yet) — deliberately staying off HEL-703's register hunk.

### D4 — Challenge lifecycle: DB-backed, 5-minute TTL, attempt-capped

DB (not the in-memory CSRF-state map at `AuthService.scala:175-191`): a login challenge is a security credential
that must survive restarts and multi-instance Cloud Run, like sessions and unlike the OAuth `state` nonce. Raw
token = 32 random bytes hex (same generator as sessions); only the sha256 stored. `expires_at = now + 5 min`;
each failed verify increments `attempts` atomically; `attempts >= 5` invalidates the challenge (client restarts
primary auth). Consumed (deleted) on success. Expired/consumed/unknown/over-cap all yield the same generic 401.

### D5 — Verify semantics

`POST /api/auth/mfa/verify { challengeToken, code }` (public — mounted in the unauthenticated `pathPrefix("auth")`
concat at `ApiRoutes.scala:426`; no session cookie exists yet so `requireCsrfHeader` is naturally inert). Code
shape dispatch: 6-digit numeric → TOTP; anything else → backup-code path (backup codes are 10 chars, Base32
alphabet, 50 bits). TOTP accepts steps `now-1..now+1` (±30s skew) but only steps `> last_used_step`, which is
persisted on every acceptance — a captured code cannot be replayed within its window (RFC 6238 §5.2). Backup code:
match against unused hashes, mark `used_at` in the same atomic update. Success → `userRepo.createSession` +
`ServiceResponse.runWith` sets the cookie + returns the standard `AuthResponse` — identical to today's login
response. Failure → generic `ServiceError.Unauthorized` (no oracle for which part failed). The same TOTP check
(minus challenge) backs enrollment confirm and disable/regenerate re-auth.

### D6 — Enrollment API (authenticated, new `MfaRoutes` mounted inside the `authenticate` concat)

- `GET  /api/auth/mfa` → `{ enabled, verifiedAt, backupCodesRemaining }`.
- `POST /api/auth/mfa/enroll` → 409 if already enabled; else upsert a fresh disabled row (re-issuing replaces any
  unconfirmed secret) and return `{ secret, otpauthUri }`. URI: `otpauth://totp/Helio:{email}?secret=…&issuer=Helio`
  (SHA1/6/30 defaults).
- `POST /api/auth/mfa/enroll/confirm { code }` → verify against the pending secret (proves the app is set up),
  set `enabled = true` + `verified_at`, generate 10 backup codes, return them **plaintext exactly once**.
- `POST /api/auth/mfa/backup-codes/regenerate { code }` → re-auth with a current TOTP/backup code; replace the set.
- `POST /api/auth/mfa/disable { code }` → re-auth with a current TOTP/backup code, then delete the `user_mfa` row
  and all backup codes. POST (not DELETE) because the re-auth proof travels in the body. A current-code re-auth is
  the one uniform mechanism that works for OAuth-only accounts, which have no password to re-enter.

All derive the acting user from `AuthenticatedUser` — no cross-user access shape exists. Formats live in a new
`MfaProtocol` mixed into `JsonProtocols`. **Correction (evaluation-1.md non-blocking note):** request bodies flow
directly into `MfaService` with no `RequestValidation` normalization step, unlike this design's original claim —
codes/tokens need no string-shape normalization (unlike e.g. email lowercasing elsewhere in the codebase), and
malformed input is safely rejected downstream by `TotpSupport.looksLikeTotpCode` / hashed-lookup misses. No
functional or security impact; this line now states what was actually built.

### D7 — Frontend: transient challenge in `authSlice`, `/login/verify` step, Settings "Security" section

`authSlice` gains `mfaChallenge: { challengeToken } | null` (transient, never persisted — survives the client-side
route hop, which component-local state cannot). `login`/`handleOAuthCallback` fulfilled payloads become a union;
on `mfaRequired` the slice stores the challenge (status stays `"unauthenticated"`) and `LoginPage.tsx:30-35` /
`OAuthCallbackPage.tsx:29-35` navigate to `/login/verify` instead of `/`. `MfaVerifyPage` (public route): code
input + "use a backup code" toggle → `verifyMfa` thunk → fulfilled sets auth + navigates `/`; visiting with no
challenge in state redirects to `/login`. Settings: one new `<section>` in `SettingsPage.tsx:52-61` rendering
`MfaSecuritySection` under `features/settings/ui/`, with service/state following the existing per-feature
`settingsService`/`settingsSlice` layout; enroll modal shows `qrcode.react` QR + manual key, then confirm-code
step, then one-time backup-codes display (copy/download) — per `DESIGN.md` tokens/components.

## Risks / Trade-offs

- [HEL-703 double-land conflict in `AuthService`/`OAuthRoutes` + canonical `email-password-auth`/
  `google-oauth-login` specs] → D3's one-call-site hunks + written merge recipe; spec deltas kept additive
  (new scenarios/clauses, no requirement rewrites). Conflict expected, resolution mechanical.
- [V88/V89 out-of-order on an already-migrated dev DB when HEL-703 lands] → this worktree runs a dedicated
  disposable `helio_hel702` DB (`.env`-only); prod/fresh DBs apply V88+V89 in order post-merge. Worst case:
  drop/recreate the dev DB.
- [TOTP secret readable in DB] → accepted non-goal (KMS absent repo-wide); same at-rest posture as bcrypt-adjacent
  credential data; RLS-less tables match the `users` precedent and are only reachable through `MfaRepository`.
- [Clock skew beyond ±30s] → out of scope; ±1 step matches common practice (Google/GitHub).

## Migration Plan

V89 is purely additive (three new tables); no backfill; rollback = revert code (tables inert). No deploy-order
hazard: MFA activates per-user only after explicit enrollment.

## Planner Notes (self-approved)

- Dependency picks (`java-otp`, `commons-codec`, `qrcode.react`): the ticket text explicitly delegates the TOTP
  library choice to Planning; the QR component is entailed by the mandated QR UI. Flagged to the human in the
  Planning summary rather than blocking escalation.
- Backup-code count (10) and length (10 Base32 chars), challenge TTL (5 min), attempt cap (5): industry-standard
  values, not AC-constrained.
- `MfaRequired` response carries no user object: security-conservative reading of the AC (AC only requires that no
  *session* be established, but leaking profile data pre-second-factor would undercut the feature's point).
