# totp-mfa-enrollment Specification

## Purpose
Backend TOTP MFA lifecycle: per-user data model, enrollment (secret issuance + confirmation), backup
codes, status, and disable — everything except the login-time gate (see `mfa-login-gate`).

## ADDED Requirements

### Requirement: MFA data model
The database SHALL have a `user_mfa` table (`user_id` UUID PK, FK → users.id ON DELETE CASCADE;
`totp_secret` TEXT NOT NULL storing the Base32 secret; `enabled` BOOLEAN NOT NULL DEFAULT FALSE;
`last_used_step` BIGINT NOT NULL DEFAULT 0; `created_at` TIMESTAMPTZ NOT NULL DEFAULT now();
`verified_at` TIMESTAMPTZ NULL) and a `mfa_backup_codes` table (`id` UUID PK default
gen_random_uuid(); `user_id` UUID NOT NULL FK → users.id ON DELETE CASCADE; `code_hash` TEXT NOT
NULL; `used_at` TIMESTAMPTZ NULL; `created_at` TIMESTAMPTZ NOT NULL DEFAULT now()). Neither table
SHALL have row-level security (both are read pre-identity on the login path, matching
`users`/`user_sessions`). Backup codes SHALL be stored only as SHA-256 hashes.

#### Scenario: Migration applies cleanly
- **WHEN** Flyway runs migrations on a database at V87
- **THEN** `user_mfa` and `mfa_backup_codes` are created with the columns and constraints above

#### Scenario: Deleting a user cascades to MFA rows
- **WHEN** a user row is deleted
- **THEN** the user's `user_mfa` row and all `mfa_backup_codes` rows are deleted automatically

### Requirement: MFA status endpoint
The system SHALL expose `GET /api/auth/mfa` (authenticated) returning `{ enabled,
verifiedAt, backupCodesRemaining }` for the acting user. `backupCodesRemaining` SHALL count only
unused codes. For a user with no `user_mfa` row it SHALL return `{ enabled: false, verifiedAt: null,
backupCodesRemaining: 0 }`.

#### Scenario: Status for an un-enrolled user
- **WHEN** an authenticated user with no MFA row calls `GET /api/auth/mfa`
- **THEN** the response is `200 OK` with `{ enabled: false, verifiedAt: null, backupCodesRemaining: 0 }`

#### Scenario: Status for an enabled user
- **WHEN** an authenticated user with MFA enabled and 7 unused backup codes calls `GET /api/auth/mfa`
- **THEN** the response is `200 OK` with `enabled: true`, a non-null `verifiedAt`, and
  `backupCodesRemaining: 7`

### Requirement: Enrollment start
The system SHALL expose `POST /api/auth/mfa/enroll` (authenticated). If the acting user already has
MFA enabled it SHALL return `409 Conflict`. Otherwise it SHALL generate a fresh 20-byte secret from a
cryptographically secure source, upsert a disabled `user_mfa` row (replacing any prior unconfirmed
secret), and return `200 OK` with `{ secret, otpauthUri }` where `secret` is the Base32 encoding and
`otpauthUri` is an `otpauth://totp/` URI carrying the secret, an issuer of `Helio`, and the user's
email as the account label. The response SHALL NOT enable MFA.

#### Scenario: Starting enrollment
- **WHEN** an authenticated user without enabled MFA calls `POST /api/auth/mfa/enroll`
- **THEN** the response is `200 OK` with a Base32 `secret` and a matching `otpauthUri`
- **AND** the stored row has `enabled = false`

#### Scenario: Enrollment start replaces an unconfirmed secret
- **WHEN** a user who started but never confirmed enrollment calls `POST /api/auth/mfa/enroll` again
- **THEN** a new secret is generated and stored, and the previous secret is no longer accepted

#### Scenario: Already enabled
- **WHEN** a user with enabled MFA calls `POST /api/auth/mfa/enroll`
- **THEN** the response is `409 Conflict` and the stored secret is unchanged

### Requirement: Enrollment confirmation
The system SHALL expose `POST /api/auth/mfa/enroll/confirm` (authenticated) accepting `{ code }`.
When the code is a valid current TOTP code for the pending secret, the system SHALL set
`enabled = true` and `verified_at`, generate 10 single-use backup codes, and return them in plaintext
in the response — the only time they are ever returned. When the code is invalid, or no pending
enrollment exists, it SHALL return `401 Unauthorized` without enabling MFA.

#### Scenario: Confirming with a valid code
- **WHEN** a user with a pending enrollment posts a TOTP code computed from the pending secret
- **THEN** the response is `200 OK` with an array of 10 backup codes
- **AND** the row has `enabled = true` and a non-null `verified_at`
- **AND** only hashes of the backup codes are stored

#### Scenario: Confirming with an invalid code
- **WHEN** a user with a pending enrollment posts a wrong code
- **THEN** the response is `401 Unauthorized` and MFA remains disabled

### Requirement: Backup code regeneration
The system SHALL expose `POST /api/auth/mfa/backup-codes/regenerate` (authenticated, MFA enabled)
accepting `{ code }` — a current TOTP or unused backup code as re-authentication. On success it SHALL
delete all existing backup codes, generate a fresh set of 10, and return them in plaintext once. On
an invalid code it SHALL return `401 Unauthorized` and leave existing codes untouched.

#### Scenario: Regenerating with a valid code
- **WHEN** an MFA-enabled user posts a valid current TOTP code to the regenerate endpoint
- **THEN** the response is `200 OK` with 10 new backup codes and all prior codes are deleted

#### Scenario: Regenerating with an invalid code
- **WHEN** an MFA-enabled user posts an invalid code
- **THEN** the response is `401 Unauthorized` and the existing codes remain valid

### Requirement: Disable MFA with re-authentication
The system SHALL expose `POST /api/auth/mfa/disable` (authenticated) accepting `{ code }` — a current
TOTP or unused backup code. On success it SHALL delete the user's `user_mfa` row and all backup
codes; subsequent logins SHALL NOT require MFA. On an invalid code, or when MFA is not enabled, it
SHALL return `401 Unauthorized`. Re-authentication uses a current code (not a password) so the
mechanism works uniformly for OAuth-only accounts.

#### Scenario: Disabling with a valid code
- **WHEN** an MFA-enabled user posts a valid current TOTP code to the disable endpoint
- **THEN** the response is `204 No Content`, the `user_mfa` row and backup codes are deleted, and the
  next login establishes a session without an MFA step

#### Scenario: Disabling with an invalid code
- **WHEN** an MFA-enabled user posts a wrong code to the disable endpoint
- **THEN** the response is `401 Unauthorized` and MFA remains enabled
