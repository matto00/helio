# Proposal: beta-invite-code-redemption

## Why

HEL-703 shipped the `free`/`beta`/`owner` tier model and gates chat access on it, but the only upgrade path today
is manual DB surgery (or the owner-email allowlist at login). HEL-704 closes the loop with the epic's chosen
human-in-the-loop gating: a `free` user asks for access, the owner is notified by email, sends back a single-use
invite code, and the user redeems it to become `beta` — no self-serve approval.

## What Changes

- New `invite_codes` table (migration **V90** — V89 is claimed by in-flight HEL-702): single-use codes stored as
  sha256 hashes, each tied to an intended recipient (`user_id`), with `redeemed_at` marking consumption.
- New authenticated endpoints: `POST /api/beta-access/request` (emails the owner(s) from `HELIO_OWNER_EMAILS`
  with requester identity) and `POST /api/beta-access/redeem` (atomically consumes a valid code for the calling
  user and sets `users.tier = 'beta'`, returning the updated user).
- First outbound-email capability in the codebase (provider chosen via escalation), config-from-env,
  Option-wired: with no API key configured, request-access degrades to 503; redemption never depends on email.
- Settings page gains a "Beta access" section: request button + code-entry field for `free` users, tier
  confirmation for `beta`/`owner`. Successful redemption refreshes the auth slice so chat unlocks without
  re-login.
- Small owner-side SQL issuance script (manual, run with a BYPASSRLS role) — no admin UI.

## Capabilities

### New Capabilities

- `beta-access-request`: a free-tier user can request Beta access; the owner is notified by email with requester
  info; degraded 503 behavior when email is unconfigured.
- `invite-code-redemption`: single-use, recipient-bound invite codes; atomic redemption upgrades tier to `beta`;
  used/invalid/foreign codes rejected with a clear error.
- `owner-notification-email`: outbound email mechanism (provider per escalation), env-configured, never logs
  secrets, absent-key degradation.
- `settings-beta-access-ui`: the Settings surface for requesting access and redeeming codes, tier-aware.

### Modified Capabilities

- `user-tier-model`: adds the requirement that tier can be upgraded `free` → `beta` by invite-code redemption,
  effective immediately (no re-login).

## Impact

- Backend: new migration V90, `InviteCodeRepository`, `BetaAccessService`, email client/service + config, new
  `BetaAccessRoutes` wired into `ApiRoutes`; `RequestValidation` additions; new protocol trait. No
  `UserRepository.scala` changes at all: the tier update runs as guarded raw SQL inside
  `InviteCodeRepository`'s own transaction, atomic with code consumption (design D3) — that is the
  HEL-702 overlap-minimizing move, not a call to the existing `updateTier`.
- Frontend: `settings` feature (new section + slice sub-tree + service calls), `auth` slice refresh on redeem.
- Env: new email-provider vars (per escalation); `HELIO_OWNER_EMAILS` reused as recipient list.
- Schemas: request schema for redeem endpoint per recent small-feature precedent.

## Non-goals

- No self-serve or automated approval; no admin UI for issuing codes (manual SQL script only).
- No code-expiry policy beyond single-use (can be a follow-up).
- No email sending on redemption, and no changes to the assistant UI's locked-state copy/CTA (follow-up).
- No password-reset or other email flows beyond the owner notification.
