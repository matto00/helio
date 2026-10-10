# local-dev-env-loading Specification

## Purpose
Defines which environment variables the local backend build forwards from `backend/.env` and the developer's shell into forked test JVMs and the forked dev server, so tests never receive developer secrets and the dev server receives only what it runs on.

## Requirements

### Requirement: Forked test JVMs receive no values from backend/.env
The build's environment for forked test JVMs SHALL NOT include any key or value read from `backend/.env`. It SHALL consist only of fixed, test-only values committed to the repository (the same public test `CONNECTOR_MASTER_KEY` and `CONNECTOR_MASTER_KEY_ID` the CI `backend` job uses). Variables already present in the process environment that launched the build are inherited as before and are not removed.

#### Scenario: Developer .env holds real credentials
- **WHEN** `backend/.env` defines `GCLOUD_DB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `CONNECTOR_MASTER_KEY` and other keys
- **THEN** the computed test environment contains none of the keys `GCLOUD_DB_PASSWORD`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `HELIO_OWNER_EMAILS`, `DB_PASSWORD`
- **AND** its `CONNECTOR_MASTER_KEY` value is the committed test-only value, not the `.env` value (proven by key name and value hash, never by printing the value)

#### Scenario: No backend/.env present
- **WHEN** `backend/.env` does not exist (as in CI)
- **THEN** the computed test environment is identical to the one computed when it does exist

### Requirement: The forked dev server receives .env values minus a never-forward list
The build's environment for the forked `sbt run` JVM SHALL include the keys defined in `backend/.env`, except keys on an explicit never-forward list, which SHALL include `GCLOUD_DB_PASSWORD`.

#### Scenario: GCLOUD_DB_PASSWORD in .env
- **WHEN** `backend/.env` defines `GCLOUD_DB_PASSWORD` and `GOOGLE_CLIENT_ID`
- **THEN** the computed run environment contains `GOOGLE_CLIENT_ID` and does not contain `GCLOUD_DB_PASSWORD`

### Requirement: A shell-exported variable takes precedence over backend/.env for the dev server
When a key is defined both in `backend/.env` and in the environment of the process running the build, the computed run environment SHALL NOT override the process environment's value with the `.env` value.

#### Scenario: Shell-exported HELIO_OWNER_EMAILS
- **WHEN** the build process environment has `HELIO_OWNER_EMAILS` set and `backend/.env` also defines `HELIO_OWNER_EMAILS` with a different value
- **THEN** the forked dev server sees the process environment's value

### Requirement: Environment contents can be inspected by key name without printing values
The build SHALL provide a task that reports, for the test and run environments, only the key names they carry (never values), and fails when the test environment carries any key outside its fixed test-only set.

#### Scenario: Agent needs to know what tests receive
- **WHEN** the key-name report task runs
- **THEN** its output lists key names only and contains no value from `backend/.env`
