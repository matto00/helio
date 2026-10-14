## MODIFIED Requirements

### Requirement: Verification step after password login
When the login form's `login` thunk resolves with `mfaRequired: true`, the login flow SHALL navigate
to a `/login/verify` step (not `/home`) rendering a code-entry form with a toggle for entering a backup
code instead. Submitting SHALL dispatch `verifyMfa`; on success the user SHALL be redirected to `/home`;
on failure an inline error SHALL be shown and the form remains usable. Navigating to `/login/verify`
with no pending challenge SHALL redirect to `/login`.

#### Scenario: MFA-enabled password login
- **WHEN** a user with MFA enabled submits valid credentials on `/login`
- **THEN** the app navigates to `/login/verify` and no session cookie exists yet

#### Scenario: Entering a valid code
- **WHEN** the user enters a valid TOTP code on `/login/verify`
- **THEN** the app navigates to `/home` with the user authenticated

#### Scenario: Entering an invalid code
- **WHEN** the user enters an invalid code
- **THEN** an inline error is displayed and the user remains on `/login/verify`

#### Scenario: Direct navigation without a challenge
- **WHEN** a visitor navigates to `/login/verify` with no pending challenge in state
- **THEN** they are redirected to `/login`

### Requirement: Verification step after OAuth callback
When `handleOAuthCallback` resolves with `mfaRequired: true`, `OAuthCallbackPage` SHALL navigate to
`/login/verify` (not `/home`), where verification proceeds identically to the password path.

#### Scenario: MFA-enabled Google login
- **WHEN** the OAuth callback exchange returns `{ mfaRequired: true, challengeToken }`
- **THEN** the browser is navigated to `/login/verify` and no session cookie exists yet
