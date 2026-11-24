# user-tier-model Specification

## Purpose
Every user record carries an account tier (free|beta|owner, default free). The config-driven owner-email allowlist grants or promotes owner only on a Google sign-in whose email Google reports as verified; password signup and login never grant or promote owner, and no user is ever demoted.

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
The system SHALL read an owner-email allowlist from configuration (secret-backed environment
variable, comma-separated, case-insensitive email comparison, surrounding whitespace ignored). The
allowlist SHALL grant or promote `owner` ONLY on Google sign-in whose profile reports the email as
verified (`email_verified == true`): a newly created Google user with a verified, matching email
SHALL be assigned `owner` instead of `free`, and a returning Google user with a verified, matching
email whose tier is not already `owner` SHALL be promoted and the promotion persisted. Password
registration and password login SHALL NEVER grant or promote `owner`, even for an allowlisted email.
The allowlist SHALL only ever promote to `owner` — it SHALL NOT demote a user whose email is absent,
and an existing `owner` SHALL keep `owner` on every auth path. An unset or empty allowlist SHALL
disable promotion without error.

#### Scenario: Allowlisted email registers and is assigned owner
- **WHEN** the allowlist contains `owner@example.test` and that email signs up via a first-time
  Google sign-in that reports `email_verified: true`
- **THEN** the created user record has `tier = owner`

#### Scenario: Unverified allowlisted Google sign-in is not owner
- **WHEN** the allowlist contains `owner@example.test` and a Google sign-in returns that email with
  `email_verified: false` or without `email_verified`
- **THEN** the user is created or signed in without `tier = owner` and the request does not fail

#### Scenario: Existing allowlisted account is promoted at login
- **WHEN** a returning Google user (the allowlisted account) whose stored tier is `free` or `beta` signs in with a verified,
  allowlisted email
- **THEN** the user's persisted tier becomes `owner` before the login response is produced
- **AND** the login response's user object reflects `tier = owner`

#### Scenario: Allowlisted password signup is not owner
- **WHEN** the allowlist contains `owner@example.test` and that email (in any case) registers via
  `POST /api/auth/register`
- **THEN** the created user record has `tier = free`

#### Scenario: Allowlisted password login does not promote
- **WHEN** an account for an allowlisted email with stored tier `free` logs in via
  `POST /api/auth/login`
- **THEN** the account's tier remains `free`

#### Scenario: Allowlist match is case-insensitive
- **WHEN** the allowlist contains `Owner@Example.test` and a verified Google sign-in returns
  `owner@example.test`
- **THEN** the user is assigned or promoted to `owner`

#### Scenario: Removal from the allowlist does not demote
- **WHEN** a user with persisted `tier = owner` signs in on either path and their email is no longer
  on the allowlist
- **THEN** the user's tier remains `owner`

#### Scenario: Unset allowlist leaves tiers unchanged
- **WHEN** the allowlist configuration is unset or empty
- **THEN** signups default to `free` and no promotion occurs, with no errors

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
