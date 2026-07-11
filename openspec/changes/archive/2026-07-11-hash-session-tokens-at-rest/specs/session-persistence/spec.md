## MODIFIED Requirements

### Requirement: user_sessions table has complete schema
The database SHALL have a `user_sessions` table with columns: `id` (UUID PK, default gen_random_uuid()), `user_id` (UUID NOT NULL, FK → users.id ON DELETE CASCADE), `token_hash` (TEXT UNIQUE NOT NULL), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT now()), `expires_at` (TIMESTAMPTZ NOT NULL), `last_seen_at` (TIMESTAMPTZ, nullable), `ip_address` (TEXT, nullable), `user_agent` (TEXT, nullable).

#### Scenario: Fresh migration runs successfully
- **WHEN** Flyway runs all migrations on a database that previously had V7
- **THEN** the `user_sessions` table is created with all required columns and constraints

#### Scenario: id is auto-generated
- **WHEN** a row is inserted without specifying `id`
- **THEN** a UUID is assigned automatically

#### Scenario: user_id foreign key is enforced
- **WHEN** a row is inserted with a `user_id` that does not exist in the `users` table
- **THEN** the database rejects the insert with a foreign key violation

#### Scenario: Deleting a user cascades to sessions
- **WHEN** a user row is deleted from the `users` table
- **THEN** all associated `user_sessions` rows are deleted automatically

#### Scenario: token_hash uniqueness is enforced
- **WHEN** two rows are inserted with the same `token_hash` value
- **THEN** the database rejects the second insert with a unique constraint violation

#### Scenario: last_seen_at is nullable
- **WHEN** a session row is inserted without `last_seen_at`
- **THEN** the row is persisted with NULL in `last_seen_at`

### Requirement: token index exists for fast lookup
The database SHALL have a unique index on `user_sessions.token_hash` to support O(log n) lookup by token hash during request authentication.

#### Scenario: Index is present after migration
- **WHEN** Flyway migrations complete
- **THEN** `\d user_sessions` in psql shows an index on `token_hash`

### Requirement: Token stored as secure hash
The `token_hash` column SHALL store only the SHA-256 hex digest of the session token, matching the hashing approach used for `api_tokens.token_hash`. The raw token value SHALL NOT be stored in the database.

#### Scenario: Token column does not contain raw bearer tokens
- **WHEN** a session is created with a raw token
- **THEN** the `token_hash` column contains the SHA-256 hex digest of the raw value, not the raw value itself

#### Scenario: Lookup hashes the incoming token before querying
- **WHEN** a request presents a raw Bearer token for session validation
- **THEN** the server computes its SHA-256 hex digest and compares against `token_hash`, never comparing the raw value directly

#### Scenario: Pre-existing raw sessions are invalidated on rollout
- **WHEN** the migration introducing `token_hash` runs against a database whose `user_sessions` rows still hold pre-migration raw tokens
- **THEN** those rows are removed rather than reinterpreted as hashes
- **AND** holders of those sessions must log in again to obtain a new, hashed session

