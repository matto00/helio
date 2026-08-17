# Design: beta-invite-code-redemption

## Context

HEL-703 (merged, V88) gives every user a `tier` (`free|beta|owner`), read fresh from the DB per request by
`ChatAccessService.guard` — so a DB tier change takes effect backend-side with no re-login. The frontend is the
real "no re-login" hazard: `auth` slice holds a tier snapshot loaded at `rehydrateAuth`/login, and four UI
surfaces (ChatPage, ActiveConversationPanel, QuickLauncherOverlay, SidebarBody) short-circuit on it.
No email capability exists anywhere in the codebase. Owner identity = `HELIO_OWNER_EMAILS` (UserTierConfig).
Escalation resolved by human: email via **Resend REST API** (resend-http).

## Goals / Non-Goals

**Goals:** free-tier request-access email to owner(s); single-use recipient-bound code redemption that upgrades
tier to `beta` effective immediately in both backend and UI; graceful degradation when email is unconfigured.

**Non-Goals:** admin/issuance UI; code expiry; email on any other event; assistant locked-state CTA changes;
`infra/deploy-backend.sh` wiring for the Resend secret (human provisions prod credentials separately).

## Decisions

- **D1 — `invite_codes` table, migration `V90__invite_codes.sql`** (V89 is claimed by in-flight HEL-702 — do
  not use it): `id UUID PK` (no DEFAULT; minted app-side per house style), `code_hash TEXT NOT NULL UNIQUE`,
  `user_id UUID NOT NULL REFERENCES users(id)` (the intended recipient), `created_at TIMESTAMPTZ NOT NULL`,
  `redeemed_at TIMESTAMPTZ NULL`. RLS per V80+ convention: ENABLE + FORCE + policy
  `USING (user_id = current_setting('app.current_user_id')::uuid)` — a redeeming user can only ever see/consume
  codes intended for them, enforcing "tied to the specific requester" at the DB layer. Add `invite_codes` to
  `RlsPolicyGuardSpec.rlsTables` in the same PR. Index on the policy predicate per convention.
- **D2 — codes stored hashed**: plaintext never persisted; `TokenHashing.sha256Hex` (already used for session
  tokens) hashes the submitted code; issuance hashes with Postgres built-in `sha256()`. Alternative (plaintext
  for ops simplicity) rejected — house style already hashes bearer secrets and issuance script handles hashing.
- **D3 — atomic redemption, one transaction** in `InviteCodeRepository(ctx: DbContext)` under
  `ctx.withUserContext(userId)`: `UPDATE invite_codes SET redeemed_at = now() WHERE code_hash = ? AND
  user_id = ? AND redeemed_at IS NULL RETURNING id` (the `AssistantDailyUsageRepository.incrementIfUnderCap`
  conditional-update-returning idiom — race-free single-use); if a row returned, `UPDATE users SET tier='beta'
  WHERE id = ? AND tier='free'` in the same `.transactionally` block. The `tier='free'` guard makes an
  owner/beta downgrade impossible even in a race; the service also pre-checks tier = `free` (409 otherwise).
  Invalid, already-used, and foreign codes are indistinguishable to the caller: one 400
  "Invalid or already-used invite code" (no oracle). No `UserRepository` changes at all — minimizes the
  HEL-702 merge-overlap surface.
- **D4 — request flow**: `POST /api/beta-access/request` (no body) → `BetaAccessService`: `userRepo.findById`
  (email/displayName/createdAt for the email body; tier check — only `free` may request, else 409); sends one
  email to all `HELIO_OWNER_EMAILS` recipients with requester email, display name, user id, created-at. An
  empty/unset `HELIO_OWNER_EMAILS` (no recipients) is treated exactly like unconfigured email → 503
  `EmailUnconfigured`. Best-effort in-memory per-user cooldown (1h) → 429 on repeat; restart-resets are
  acceptable (protects a human inbox from double-clicks, not a security boundary).
- **D5 — bespoke error ADT** `BetaAccessError` mirroring `ChatAccessError`'s completion pattern:
  `EmailUnconfigured` → 503 (mirrors authoring's no-ANTHROPIC_API_KEY degradation), `NotEligible` → 409,
  `Cooldown` → 429, `SendFailed` → 502, `InvalidCode` → 400. `ServiceError` has no 503/429 members and is
  shared — not extended.
- **D6 — email client, new `com.helio.email` package** (mirrors `com.helio.ai`): trait `EmailSender`
  (`send(to, subject, text): Future[Either[String, Unit]]`), `HttpResendEmailSender` via
  `Http(system).singleRequest` `POST https://api.resend.com/emails` with `Authorization: Bearer` — copy
  `HttpClaudeTransport`'s connection settings/timeouts; `EmailConfig.fromEnv(): Either[String, EmailConfig]`
  reading `RESEND_API_KEY` + `HELIO_EMAIL_FROM`, redacting `toString`, key never logged. Wired in
  `Main`/`ApiRoutes` as `Option[EmailSender]` (None when env unset) → `BetaAccessService` returns
  `EmailUnconfigured` for request-access; redemption never touches email.
- **D7 — routes**: new `BetaAccessRoutes(service, user)` under the `authenticate` branch of `ApiRoutes`,
  `pathPrefix("beta-access")`, `path("request")` + `path("redeem")`, both POST. Redeem body `{ "code": ... }`
  validated by `RequestValidation.validateRedeemInviteCodeRequest` (trim, non-empty, ≤128 chars). Redeem
  response = updated `UserResponse` (existing AuthProtocol shape, already carries `tier`). New
  `BetaAccessProtocol` trait added to `JsonProtocols` extends-list.
- **D8 — frontend**: new `BetaAccessSection` on `SettingsPage` (third section, PreferencesEditor pattern:
  TextField + explicit buttons + InlineError). Tier-aware via `auth` slice: `free` → request button + code
  field; `beta`/`owner` → confirmation copy. `settingsSlice` gains `betaAccess` sub-tree (request/redeem
  status+error per house style); redeem thunk dispatches `setAuth({ user })` with the endpoint's returned
  `UserResponse` — this is what unlocks chat UI without re-login (AC#2's real risk).
- **D9 — issuance**: `backend/scripts/issue-invite-code.sql` (psql, `-v email=...`): resolves the user by
  email, generates a random code, inserts its sha256 hash bound to that `user_id`, prints the plaintext once.
  Header documents it must run as a BYPASSRLS role (dev superuser / `helio_privileged`) since FORCE RLS blocks
  app-context inserts.
- **D10 — contract artifacts**: `schemas/redeem-invite-code-request.schema.json` (small-feature precedent:
  `create-api-token-request`); CLAUDE.md env-table rows for `RESEND_API_KEY` / `HELIO_EMAIL_FROM`;
  `.env.example` entries.

## Risks / Trade-offs

- [HEL-702 lands first and conflicts] → this change deliberately leaves `UserRepository.scala` untouched;
  V90 vs V89 numbering pre-agreed; conflict surface ≈ `ApiRoutes`/`Main` wiring lines only.
- [Resend outage / bad key] → `SendFailed` 502 with clear message; request can be retried; no state written.
- [In-memory cooldown lost on restart] → accepted; consequence is at most a duplicate email to a human.
- [Fresh dev DB (`helio_hel704`) has no seeded users] → UI verification registers a fresh user (which is
  `free` by construction — exactly the flow under test); codes issued via D9 script as dev superuser.
- [Email deliverability unprovisioned in prod] → intentionally decoupled: 503 until human provisions key.

## Migration Plan

Flyway V90 on boot; empty fresh DBs build V1→V90. Rollback = revert commit; table is additive-only.

## Planner Notes

Self-approved: D1–D10 above; using `ADDED Requirements` in the `user-tier-model` delta (new upgrade-path
requirement; no existing requirement's text changes); dev-DB isolation for this worktree (`createdb
helio_hel704`, edit gitignored `backend/.env` — env-only, never committed); no deploy-script changes (scoped
to the human's prod provisioning). Escalated and human-decided: email mechanism = resend-http.
