# Proposal: add-totp-mfa (HEL-702)

## Why

Helio accounts are protected by a single factor (password, or Google OAuth). HEL-701 (account
security + user tiers) calls for TOTP-based MFA as a second factor: a stolen password or hijacked
OAuth grant should not be enough to establish a session. TOTP (RFC 6238) works offline with any
standard authenticator app and requires no third-party messaging infrastructure.

## What Changes

- New tables (migration **V89** — V88 is claimed by HEL-703's unmerged branch, per dispatch):
  `user_mfa` (per-user TOTP secret, enabled flag, created/verified timestamps), `mfa_backup_codes`
  (hashed single-use recovery codes), `mfa_login_challenges` (short-lived pending-login challenges,
  hashed tokens, mirroring `user_sessions`' token-hash pattern).
- Enrollment API (authenticated): start enrollment (secret + `otpauth://` URI for client-side QR
  rendering), confirm with a live TOTP code (enables MFA, returns backup codes exactly once),
  regenerate backup codes, disable (re-auth with a current code), and a status endpoint.
- Login gate: when MFA is enabled for the account, **both** primary auth paths — password
  (`AuthService.login`) and Google OAuth (`AuthService.completeOAuth` via `OAuthRoutes`) — stop
  short of session creation and instead return `{ mfaRequired: true, challengeToken }`. A public
  verify endpoint accepts the challenge token plus a TOTP or backup code and only then creates the
  `user_sessions` row and sets the `helio_session` cookie. Accounts without MFA behave exactly as
  today.
- Frontend: a Security section on `/settings` (enroll with QR + manual key, confirm with a code,
  view-once/regenerate backup codes, disable) and a code-entry verification step in the login flow
  (password form and OAuth callback page), shown only when the backend signals `mfaRequired`.
- New dependencies: a small RFC 6238 TOTP library backend-side and a QR-rendering component
  frontend-side (none exists today — choices justified in design.md).

## Capabilities

### New Capabilities

- `totp-mfa-enrollment`: backend MFA lifecycle — data model, enroll/confirm/status/regenerate/
  disable endpoints, backup-code semantics.
- `mfa-login-gate`: backend session-establishment gate — pending-login challenge, public verify
  endpoint, uniform behavior across both primary auth paths.
- `mfa-settings-ui`: the Settings Security section (enroll, backup codes, disable).
- `mfa-login-verification-ui`: the login-flow code-entry step (password and OAuth callback paths).

### Modified Capabilities

- `email-password-auth`: the login requirement gains an MFA-enabled branch — success no longer
  unconditionally sets `helio_session`.
- `google-oauth-login`: the callback requirement gains the same MFA-enabled branch.
- `frontend-auth-ui`: "on success the user SHALL be redirected to `/`" gains the MFA branch
  (redirect to the verification step instead).
- `google-oauth-callback-page`: "on 200 OK … navigates to `/`" gains the same MFA branch.

## Impact

- Backend: `AuthService` (minimal, isolated hunks at the session-establishment points — HEL-703
  touches the same lines; see design.md), `AuthRoutes`, `OAuthRoutes`, new `MfaService` + MFA
  repository, `JsonProtocols`/auth protocols, migration V89, new TOTP library dependency.
- Frontend: login page + OAuth callback page, auth slice/service, new Settings Security section,
  QR rendering.
- Schemas: new MFA request/response schemas; login/OAuth response schema gains the
  `mfaRequired`/`challengeToken` variant.

## Non-goals

- WebAuthn/passkeys, SMS/email codes, or "remember this device" — TOTP + backup codes only.
- Encrypting TOTP secrets at rest with a KMS (no key-management infra exists in helio today;
  secrets live in the DB like other credentials, protected by the same access controls).
- Admin/tier-driven MFA enforcement policies (HEL-703 territory) — MFA here is strictly per-user
  opt-in.
- Rate-limiting beyond the challenge attempt cap (no global login throttling exists today).
