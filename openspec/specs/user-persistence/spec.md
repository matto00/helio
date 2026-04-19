# user-persistence Specification

## Purpose
TBD - created by archiving change db-schema-users-table. Update Purpose after archive.
## Requirements
### Requirement: Users table has complete schema
The database SHALL have a `users` table with all columns required for both local and OAuth authentication: `id` (UUID PK), `email` (unique, not null), `display_name` (nullable text), `avatar_url` (nullable text), `password_hash` (nullable text), `google_id` (nullable text, unique), `auth_provider` (enum: google|local, nullable), `created_at` (timestamptz not null), `updated_at` (timestamptz not null).

#### Scenario: Fresh migration runs successfully
- **WHEN** Flyway runs on an empty database
- **THEN** the `users` table is created with all required columns and constraints

#### Scenario: email uniqueness is enforced
- **WHEN** two rows are inserted with the same email address
- **THEN** the database rejects the second insert with a unique constraint violation

#### Scenario: google_id uniqueness is enforced
- **WHEN** two rows are inserted with the same non-null google_id
- **THEN** the database rejects the second insert with a unique constraint violation

#### Scenario: google_id uniqueness allows multiple NULLs
- **WHEN** multiple rows are inserted with NULL google_id
- **THEN** all rows are accepted (partial unique index on non-null values only)

#### Scenario: password_hash is nullable
- **WHEN** a user row is inserted with NULL password_hash
- **THEN** the insert succeeds without error

### Requirement: auth_provider enum is defined
The database SHALL have an `auth_provider` PostgreSQL enum type with values `google` and `local`.

#### Scenario: Valid enum value is accepted
- **WHEN** a row is inserted with auth_provider = 'google' or 'local'
- **THEN** the insert succeeds

#### Scenario: Invalid enum value is rejected
- **WHEN** a row is inserted with an auth_provider value not in ('google', 'local')
- **THEN** the database rejects the insert with a type error

### Requirement: password_hash is excluded from API responses
The system SHALL never include `password_hash` in any API response payload.

#### Scenario: User information endpoint does not expose password_hash
- **WHEN** any API endpoint returns user information
- **THEN** the response body does not contain a `password_hash` field

### Requirement: Slick UserRow reflects nullable password_hash
The Slick `UserRow` case class SHALL map `password_hash` as `Option[String]` and `UserRepository` SHALL NOT accept a plain `String` for password_hash in any public method signature.

#### Scenario: Insert with no password (OAuth user)
- **WHEN** `UserRepository.insert` is called with `passwordHash = None`
- **THEN** the row is persisted with NULL in the password_hash column

#### Scenario: Insert with password (local user)
- **WHEN** `UserRepository.insert` is called with `passwordHash = Some(hash)`
- **THEN** the row is persisted with the hash value in the password_hash column

