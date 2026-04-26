## MODIFIED Requirements

### Requirement: Schema managed by Flyway
The backend SHALL apply database migrations automatically on startup using Flyway. Database credentials (username and password) SHALL be configurable via environment
variables `DB_USER` and `DB_PASSWORD`; when absent, the connection falls back to URL-only authentication suitable for local development.

#### Scenario: Fresh database is initialised
- **WHEN** the backend starts against a database with no schema
- **THEN** Flyway applies all pending migrations before accepting requests

#### Scenario: Production credentials are used when provided
- **WHEN** the `DB_USER` and `DB_PASSWORD` environment variables are set
- **THEN** Flyway and Slick both connect using those credentials

#### Scenario: Local dev falls back to URL-only auth
- **WHEN** `DB_USER` and `DB_PASSWORD` are not set
- **THEN** Flyway and Slick connect using URL-only authentication with no username/password
