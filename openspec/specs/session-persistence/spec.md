# session-persistence Specification

## Purpose
Database schema and lifecycle rules for user sessions: token storage as a secure hash, expiry enforcement, cascade deletion on user removal, and server-side invalidation on logout.
## Requirements
### Requirement: user_sessions table has complete schema
The database SHALL have a `user_sessions` table with columns: `id` (UUID PK, default gen_random_uuid()), `user_id` (UUID NOT NULL, FK → users.id ON DELETE CASCADE), `token` (TEXT UNIQUE NOT NULL), `created_at` (TIMESTAMPTZ NOT NULL DEFAULT now()), `expires_at` (TIMESTAMPTZ NOT NULL), `last_seen_at` (TIMESTAMPTZ, nullable), `ip_address` (TEXT, nullable), `user_agent` (TEXT, nullable).

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

#### Scenario: token uniqueness is enforced
- **WHEN** two rows are inserted with the same `token` value
- **THEN** the database rejects the second insert with a unique constraint violation

#### Scenario: last_seen_at is nullable
- **WHEN** a session row is inserted without `last_seen_at`
- **THEN** the row is persisted with NULL in `last_seen_at`

### Requirement: token index exists for fast lookup
The database SHALL have a unique index on `user_sessions.token` to support O(log n) lookup by token during request authentication.

#### Scenario: Index is present after migration
- **WHEN** Flyway migrations complete
- **THEN** `\d user_sessions` in psql shows an index on `token`

### Requirement: Token stored as secure hash
The `token` column SHALL store only a hashed representation of the session token. The raw token value SHALL NOT be stored in the database.

#### Scenario: Token column does not contain raw bearer tokens
- **WHEN** a session is created with a raw token
- **THEN** the `token` column contains a hash, not the original value

### Requirement: Expired sessions do not authenticate requests
The system SHALL reject authentication attempts using tokens whose `expires_at` is in the past.

#### Scenario: Expired session is rejected
- **WHEN** a request presents a token whose session row has `expires_at < now()`
- **THEN** the server responds with 401 Unauthorized

#### Scenario: Active session is accepted
- **WHEN** a request presents a token whose session row has `expires_at >= now()`
- **THEN** the server proceeds with the authenticated request

### Requirement: Sessions can be invalidated server-side on logout
The system SHALL support deleting a session row to invalidate it, after which the corresponding token SHALL NOT authenticate future requests.

#### Scenario: Deleted session token is rejected
- **WHEN** a session row is deleted and a subsequent request presents the same token
- **THEN** the server responds with 401 Unauthorized

