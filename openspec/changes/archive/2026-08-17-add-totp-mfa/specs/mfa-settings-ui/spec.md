# mfa-settings-ui Specification

## Purpose
The Settings "Security" section: enroll in TOTP MFA (QR + manual key + confirmation), view status,
regenerate backup codes, and disable.

## ADDED Requirements

### Requirement: Security section on the Settings page
The `/settings` page SHALL render a "Security" section showing the account's MFA status (from
`GET /api/auth/mfa`): either an "enable" affordance when MFA is off, or the enabled state with
`backupCodesRemaining`, a regenerate-backup-codes affordance, and a disable affordance when on.

#### Scenario: Section reflects un-enrolled state
- **WHEN** a user without MFA opens `/settings`
- **THEN** the Security section shows MFA as off with an affordance to enable it

#### Scenario: Section reflects enabled state
- **WHEN** a user with MFA enabled and 7 unused backup codes opens `/settings`
- **THEN** the Security section shows MFA as on, shows 7 backup codes remaining, and offers
  regenerate and disable affordances

### Requirement: Enrollment flow
Starting enrollment SHALL call `POST /api/auth/mfa/enroll` and render the returned `otpauthUri` as a
QR code together with the Base32 `secret` as a copyable manual-entry key, then prompt for a
6-digit confirmation code. Submitting the code SHALL call `POST /api/auth/mfa/enroll/confirm`; on
success the UI SHALL display the returned backup codes exactly once with copy affordances and a
notice that they will not be shown again; on `401` it SHALL show an inline error and allow retry
without restarting enrollment.

#### Scenario: Enrolling end-to-end
- **WHEN** the user starts enrollment, scans the QR code, and submits a valid code
- **THEN** the backup codes are displayed once with a copy affordance
- **AND** after dismissal the section shows MFA as enabled

#### Scenario: Wrong confirmation code
- **WHEN** the user submits an invalid confirmation code
- **THEN** an inline error is shown and the QR/manual key remain visible for retry

### Requirement: Backup code regeneration flow
The regenerate affordance SHALL prompt for a current TOTP or backup code, call
`POST /api/auth/mfa/backup-codes/regenerate`, and on success display the new set exactly once,
making clear that previous codes are now invalid.

#### Scenario: Regenerating codes
- **WHEN** an MFA-enabled user requests regeneration and enters a valid current code
- **THEN** the new backup codes are displayed once and the shown remaining count resets to 10

### Requirement: Disable flow requires re-authentication
The disable affordance SHALL prompt for a current TOTP or backup code and call
`POST /api/auth/mfa/disable`. On success the section SHALL return to the un-enrolled state. On `401`
an inline error SHALL be shown and MFA SHALL remain enabled.

#### Scenario: Disabling MFA
- **WHEN** an MFA-enabled user opens the disable prompt and enters a valid current code
- **THEN** the section shows MFA as off

#### Scenario: Disable with wrong code
- **WHEN** the user enters an invalid code in the disable prompt
- **THEN** an inline error is shown and the section still shows MFA as on
