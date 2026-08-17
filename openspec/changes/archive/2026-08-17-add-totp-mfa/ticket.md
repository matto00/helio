# HEL-702: Add TOTP-based MFA (data model + enrollment/verification UI)

## Description

TOTP (RFC 6238) as a second factor, applied uniformly after either existing primary auth path succeeds (password via `AuthService`, Google OAuth via `OAuthRoutes`) — not replacing either.

Backend:

- New table (secret, enabled flag, backup codes, created/verified timestamps) tied to the user.
- Enrollment endpoint: generate a secret + otpauth:// URI for QR rendering.
- Verify endpoint: confirm a TOTP code during enrollment (proves the user's app is actually set up) and during login (once enabled).
- Backup codes: generate a set at enrollment, single-use, for account recovery if the authenticator is lost.
- Gate the session-establishing step (post-password or post-OAuth-callback) on MFA verification when enabled for that account.

Frontend:

- Settings page: enroll (show QR code + manual entry key, confirm with a code), view/regenerate backup codes, disable (re-auth required).
- Login flow: a verification step (code entry) after primary auth succeeds, only when the account has MFA enabled.

## Acceptance Criteria

- [ ] A user can enroll in TOTP MFA from Settings (QR code, confirms with a real code from their authenticator app).
- [ ] Once enabled, both the password-login and Google-OAuth-login paths require a valid TOTP code (or backup code) before a session is established.
- [ ] Backup codes are single-use and let a user recover access without their authenticator app.
- [ ] A user can disable MFA (re-authenticating first).

## Dispatch Constraints (from parent session — plan around, do not escalate)

- **Migration number:** main currently maxes out at V87, but sibling ticket HEL-703 (unmerged, resolving conflicts) has already claimed **V88** on its branch. This change MUST use **V89** even though V88 looks free in this checkout.
- **File overlap with HEL-703:** HEL-703 also modifies `backend/src/main/scala/com/helio/services/AuthService.scala` and `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala` (assigning `tier` at signup+login). This ticket gates the same post-primary-auth-success moment on MFA. A real merge conflict is expected when both land. Structure the login-flow edits as minimal, well-isolated hunks (e.g. a single clearly-delimited MFA-gate call inserted at the session-establishment point rather than restructuring the function) to make later conflict resolution mechanical.
- **Dev DB isolation:** use a fresh local Postgres database dedicated to this worktree (e.g. `helio_hel702`), configured via the worktree's gitignored `backend/.env` only — never committed. Three tickets have contended for the shared dev DB today.
- **Ports:** DEV_PORT=6134, BACKEND_PORT=9041 (authoritative, from setup-worktree.sh).
