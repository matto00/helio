# user-persistence Delta Spec

## MODIFIED Requirements

### Requirement: Users table has complete schema
The database SHALL have a `users` table with all columns required for both local and OAuth authentication: `id` (UUID PK), `email` (unique, not null), `display_name` (nullable text), `avatar_url` (nullable text), `password_hash` (nullable text), `google_id` (nullable text, unique), `auth_provider` (enum: google|local, nullable), `tier` (text, not null, default `'free'`, constrained to `free|beta|owner`), `created_at` (timestamptz not null), `updated_at` (timestamptz not null).

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

#### Scenario: tier defaults to free and rejects unknown values
- **WHEN** a user row is inserted without an explicit tier
- **THEN** the persisted row has `tier = 'free'`
- **AND** an insert or update with a tier outside `free|beta|owner` is rejected by a check constraint

#### Scenario: Existing rows are backfilled to free
- **WHEN** the tier migration runs against a database with pre-existing user rows
- **THEN** every existing row ends with `tier = 'free'` and the column is `NOT NULL`
