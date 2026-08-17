# google-oauth-callback-page Delta (add-totp-mfa)

## MODIFIED Requirements

### Requirement: OAuthCallbackPage exchanges code with backend
When `OAuthCallbackPage` mounts and a `code` query parameter is present, the component SHALL call
`GET /api/auth/google/callback` with the `code` (and `state` if present) forwarded as query
parameters via the axios http client. When the `200 OK` response carries `{ expiresAt, user }` the
component SHALL dispatch auth state and navigate to `/`; when it carries
`{ mfaRequired: true, challengeToken }` the component SHALL store the challenge (per
`mfa-login-verification-ui`) and navigate to `/login/verify` instead.

#### Scenario: Successful code exchange
- **WHEN** the browser lands on `/auth/callback?code=valid-code` for an account without MFA
- **THEN** the component calls `GET /api/auth/google/callback?code=valid-code` via axios
- **AND** on a `200 OK` response dispatches `setAuth({ token, user })` and navigates to `/`

#### Scenario: Exchange resolves to an MFA challenge
- **WHEN** the browser lands on `/auth/callback?code=valid-code` for an MFA-enabled account
- **THEN** the component navigates to `/login/verify` without dispatching `setAuth`

#### Scenario: Code is exchanged only once per mount
- **WHEN** the component mounts in React 18 StrictMode (which double-invokes effects)
- **THEN** `GET /api/auth/google/callback` is called exactly once for a given code value
