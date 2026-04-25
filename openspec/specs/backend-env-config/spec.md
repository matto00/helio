# backend-env-config Specification

## Purpose
TBD - created by archiving change make-config-env-driven. Update Purpose after archive.
## Requirements
### Requirement: PORT env var controls HTTP bind port
The server SHALL read the `PORT` environment variable as the primary port binding, falling back to `HELIO_HTTP_PORT`, then defaulting to `8080` if neither is set.

#### Scenario: Cloud Run injects PORT
- **WHEN** the `PORT` environment variable is set to `9090`
- **THEN** the HTTP server binds on port `9090`

#### Scenario: Local dev uses HELIO_HTTP_PORT
- **WHEN** `PORT` is not set and `HELIO_HTTP_PORT` is set to `8081`
- **THEN** the HTTP server binds on port `8081`

#### Scenario: No port env vars set
- **WHEN** neither `PORT` nor `HELIO_HTTP_PORT` is set
- **THEN** the HTTP server binds on port `8080`

### Requirement: Individual DB params configurable via env vars
The server SHALL support configuring DB connection details via individual env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. When `DATABASE_URL` is set it SHALL take precedence over individually constructed URL.

#### Scenario: Individual DB params used
- **WHEN** `DB_HOST=db.example.com`, `DB_PORT=5432`, `DB_NAME=helio_prod`, `DB_USER=helio`, `DB_PASSWORD=secret` are set and `DATABASE_URL` is not set
- **THEN** the application connects to `jdbc:postgresql://db.example.com:5432/helio_prod` with the given credentials

#### Scenario: DATABASE_URL overrides individual params
- **WHEN** both `DATABASE_URL` and `DB_HOST` are set
- **THEN** the application uses the `DATABASE_URL` value for the connection

#### Scenario: Local dev defaults apply
- **WHEN** no DB env vars are set
- **THEN** the application attempts to connect to `jdbc:postgresql://localhost:5432/helio`

### Requirement: Log level configurable via LOG_LEVEL env var
The server SHALL read the `LOG_LEVEL` environment variable and apply it as both the Akka loglevel and logback root level. Default SHALL be `INFO`.

#### Scenario: LOG_LEVEL set to DEBUG
- **WHEN** `LOG_LEVEL=DEBUG` is set
- **THEN** Akka and logback both emit debug-level log output

#### Scenario: LOG_LEVEL not set
- **WHEN** `LOG_LEVEL` is not set
- **THEN** logging defaults to `INFO` level

### Requirement: CORS allowed origins configurable via env var
The server SHALL read `CORS_ALLOWED_ORIGINS` as a comma-separated list of allowed origins for CORS preflight and cross-origin responses. Default SHALL be `http://localhost:5173`.

#### Scenario: Single origin configured
- **WHEN** `CORS_ALLOWED_ORIGINS=https://app.helio.dev`
- **THEN** the server accepts cross-origin requests from `https://app.helio.dev` only

#### Scenario: Multiple origins configured
- **WHEN** `CORS_ALLOWED_ORIGINS=https://app.helio.dev,https://staging.helio.dev`
- **THEN** the server accepts cross-origin requests from either origin

#### Scenario: No env var set
- **WHEN** `CORS_ALLOWED_ORIGINS` is not set
- **THEN** the server allows cross-origin requests from `http://localhost:5173`

### Requirement: .env.example documents all env vars
A `.env.example` file SHALL exist at the repository root listing every supported environment variable with default values and inline comments.

#### Scenario: Developer clones repo
- **WHEN** a developer clones the repository and runs `cp .env.example .env`
- **THEN** the resulting `.env` file contains all required and optional env vars with safe local defaults

