## ADDED Requirements

### Requirement: Database credentials are configurable via environment variables
The backend SHALL support configuring the database username and password via `DB_USER` and `DB_PASSWORD` environment variables, passed to both Flyway and Slick. When absent, the
connection falls back to URL-only authentication suitable for local development.

#### Scenario: Production credentials are used when provided
- **WHEN** the `DB_USER` and `DB_PASSWORD` environment variables are set
- **THEN** Flyway and Slick both connect using those credentials

#### Scenario: Local dev falls back to URL-only auth
- **WHEN** `DB_USER` and `DB_PASSWORD` are not set
- **THEN** Flyway and Slick connect using URL-only authentication with no username/password
