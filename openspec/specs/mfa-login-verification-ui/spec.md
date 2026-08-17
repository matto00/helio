# mfa-login-verification-ui Specification

## Purpose
The login-flow verification step: after primary auth succeeds for an MFA-enabled account (password form or OAuth callback), the user enters a TOTP or backup code before a session exists client-side.
## Requirements
### Requirement: Auth slice carries a transient MFA challenge
The `authSlice` SHALL gain a `mfaChallenge: { challengeToken: string } | null` field, set when a
`login` or `handleOAuthCallback` thunk resolves with `{ mfaRequired: true, challengeToken }` and
cleared on successful verification, logout, or `clearAuth`. The challenge SHALL live only in Redux
memory — never in `localStorage`/`sessionStorage` — and `auth.status` SHALL remain
`"unauthenticated"` while a challenge is pending. A `verifyMfa` thunk SHALL post
`{ challengeToken, code }` to `/api/auth/mfa/verify` and, on success, set the current user and
`status: "authenticated"` exactly as a normal login fulfillment does.

#### Scenario: Login thunk stores the challenge
- **WHEN** the `login` thunk resolves with `mfaRequired: true`
- **THEN** `auth.mfaChallenge` holds the challenge token, `auth.currentUser` is `null`, and
  `auth.status` is `"unauthenticated"`

#### Scenario: Successful verification authenticates
- **WHEN** the `verifyMfa` thunk fulfills
- **THEN** `auth.currentUser` is set, `auth.status` is `"authenticated"`, and `auth.mfaChallenge` is
  `null`

### Requirement: Verification step after password login
When the login form's `login` thunk resolves with `mfaRequired: true`, the login flow SHALL navigate
to a `/login/verify` step (not `/`) rendering a code-entry form with a toggle for entering a backup
code instead. Submitting SHALL dispatch `verifyMfa`; on success the user SHALL be redirected to `/`;
on failure an inline error SHALL be shown and the form remains usable. Navigating to `/login/verify`
with no pending challenge SHALL redirect to `/login`.

#### Scenario: MFA-enabled password login
- **WHEN** a user with MFA enabled submits valid credentials on `/login`
- **THEN** the app navigates to `/login/verify` and no session cookie exists yet

#### Scenario: Entering a valid code
- **WHEN** the user enters a valid TOTP code on `/login/verify`
- **THEN** the app navigates to `/` with the user authenticated

#### Scenario: Entering an invalid code
- **WHEN** the user enters an invalid code
- **THEN** an inline error is displayed and the user remains on `/login/verify`

#### Scenario: Direct navigation without a challenge
- **WHEN** a visitor navigates to `/login/verify` with no pending challenge in state
- **THEN** they are redirected to `/login`

### Requirement: Verification step after OAuth callback
When `handleOAuthCallback` resolves with `mfaRequired: true`, `OAuthCallbackPage` SHALL navigate to
`/login/verify` (not `/`), where verification proceeds identically to the password path.

#### Scenario: MFA-enabled Google login
- **WHEN** the OAuth callback exchange returns `{ mfaRequired: true, challengeToken }`
- **THEN** the browser is navigated to `/login/verify` and no session cookie exists yet

