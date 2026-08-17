# user-tier-model Specification

## Purpose
Every user record carries an account tier (free|beta|owner, default free) assigned at signup and refreshed at login on both auth paths via a config-driven owner-email allowlist, so owner access survives a fresh environment without manual DB edits.. Update Purpose after archive.
## Requirements
### Requirement: User record carries an account tier
Every user record SHALL carry a `tier` value that is exactly one of `free`, `beta`, or `owner`.
New user records SHALL default to `free` regardless of auth provider. The tier SHALL be persisted on
the user row and SHALL be readable wherever the authenticated user is resolved for a request.

#### Scenario: New password signup defaults to free
- **WHEN** a user registers via `POST /api/auth/register` with an email not on the owner allowlist
- **THEN** the created user record has `tier = free`

#### Scenario: New Google OAuth signup defaults to free
- **WHEN** a user completes first-time Google OAuth login with an email not on the owner allowlist
- **THEN** the created user record has `tier = free`

#### Scenario: Invalid tier value is rejected by the database
- **WHEN** a user row is inserted or updated with a tier value outside `free|beta|owner`
- **THEN** the database rejects the write with a constraint violation

### Requirement: Config-driven owner-email allowlist
The system SHALL read an owner-email allowlist from configuration (env-var-backed, comma-separated,
case-insensitive email comparison, surrounding whitespace ignored). The allowlist SHALL be applied on
**both** auth paths (email/password and Google OAuth): at signup, a matching email SHALL be assigned
`owner` instead of `free`; at login, a matching existing user whose tier is not already `owner` SHALL
be promoted to `owner` and the promotion persisted. The allowlist SHALL only ever promote to `owner`
— it SHALL NOT demote a user whose email is absent. An unset or empty allowlist SHALL disable
promotion without error.

#### Scenario: Allowlisted email registers and is assigned owner
- **WHEN** the allowlist contains `mattheworr018@gmail.com` and that email registers via either auth
  path
- **THEN** the created user record has `tier = owner`

#### Scenario: Existing allowlisted account is promoted at login
- **WHEN** a user whose email is on the allowlist and whose stored tier is `free` or `beta` logs in
  via either auth path
- **THEN** the user's persisted tier becomes `owner` before the login response is produced
- **AND** the login response's user object reflects `tier = owner`

#### Scenario: Allowlist match is case-insensitive
- **WHEN** the allowlist contains `Owner@Example.com` and `owner@example.com` logs in
- **THEN** the user is promoted to `owner`

#### Scenario: Removal from the allowlist does not demote
- **WHEN** a user with persisted `tier = owner` logs in and their email is no longer on the allowlist
- **THEN** the user's tier remains `owner`

#### Scenario: Unset allowlist leaves tiers unchanged
- **WHEN** the allowlist configuration is unset or empty
- **THEN** signups default to `free` and no login promotion occurs, with no errors

### Requirement: Tier upgrade via invite-code redemption
The system SHALL support upgrading a user's tier from `free` to `beta` by redeeming a single-use invite code.
The upgrade SHALL be persisted on the user row in the same transaction that consumes the code and SHALL be
effective immediately for subsequent requests (tier is read fresh per request — no re-login or new session
required). Redemption SHALL never change the tier of a user whose tier is not `free`.

#### Scenario: Redemption persists the beta tier immediately
- **WHEN** a `free` user successfully redeems an invite code
- **THEN** the user row's tier is `beta` and the next tier-gated request (e.g. chat access) succeeds without
  re-authentication

#### Scenario: Redemption cannot demote an owner
- **WHEN** a user whose tier is `owner` attempts redemption
- **THEN** the request is rejected and the tier remains `owner`

