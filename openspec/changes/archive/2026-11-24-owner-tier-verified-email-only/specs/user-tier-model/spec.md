## MODIFIED Requirements

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
