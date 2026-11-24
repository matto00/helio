# email-normalization Specification

## Purpose
Emails are trimmed and lowercased at every auth entry point (register, login, Google sign-in), and the database enforces case-insensitive email uniqueness, so a case-variant of an existing address can never become a second account.

## Requirements

### Requirement: Emails are normalised at every auth entry point
The system SHALL trim surrounding whitespace from and lowercase (locale-independently) every email
address received by password registration, password login and Google sign-in before it is looked up,
stored, or compared against the owner allowlist. All three entry points SHALL use the same
normalisation.

#### Scenario: Registration stores the normalised email
- **WHEN** `POST /api/auth/register` is called with email `"  New.User@Example.TEST "`
- **THEN** the created user's stored and returned email is `new.user@example.test`

#### Scenario: Login with a differently-cased email finds the account
- **WHEN** an account exists for `user@example.test` and `POST /api/auth/login` is called with
  `USER@Example.Test` and the correct password
- **THEN** the login succeeds for that account

#### Scenario: Google sign-in stores the normalised email
- **WHEN** a first-time Google sign-in returns email `Someone@Example.TEST`
- **THEN** the created user's stored email is `someone@example.test`

### Requirement: Database enforces case-insensitive email uniqueness
The `users` table SHALL enforce uniqueness of `lower(email)`, and stored emails SHALL be lowercased.
The migration that introduces this SHALL fail with a clear error, changing no rows, when existing
rows collide case-insensitively (after trimming); it SHALL NOT merge or delete rows.

#### Scenario: Migration lowercases stored emails
- **WHEN** the migration runs over rows whose emails contain upper-case letters and no collisions
- **THEN** every stored email equals its trimmed lower-case form and a unique index on
  `lower(email)` exists

#### Scenario: Migration refuses case-duplicates
- **WHEN** the migration runs and two rows hold `a@example.test` and `A@Example.test`
- **THEN** the migration fails with an error that says case-insensitive email duplicates exist and
  must be resolved manually
- **AND** both rows are unchanged

#### Scenario: Case-variant duplicate insert is rejected
- **WHEN** a row for `a@example.test` exists and a write inserts `A@EXAMPLE.TEST`
- **THEN** the database rejects the write with a unique violation
