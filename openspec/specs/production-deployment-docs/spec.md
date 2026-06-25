# production-deployment-docs Specification

## Purpose
README documentation for deploying the backend to Cloud Run: required env vars, Docker image build, automatic Flyway migrations, and log access via Cloud Logging.
## Requirements
### Requirement: README documents production environment variables
README.md SHALL include a list of all required environment variables consumed by the backend at runtime, each with a brief description.

#### Scenario: Operator reads env var list
- **WHEN** an operator reads the "Running in production" section of README.md
- **THEN** they SHALL find DATABASE_URL and AKKA_LICENSE_KEY listed with descriptions

### Requirement: README documents Docker image build
README.md SHALL include the command to build the Docker image from the repository root.

#### Scenario: Operator builds Docker image
- **WHEN** an operator follows the Docker build instructions in README.md
- **THEN** they SHALL be able to build a runnable image with a single command

### Requirement: README documents database migrations
README.md SHALL explain that Flyway migrations run automatically on server startup and no separate migration command is required.

#### Scenario: Operator deploys without manual migration step
- **WHEN** an operator starts the Docker container
- **THEN** migrations SHALL run automatically and the README SHALL reflect this behavior

### Requirement: README documents Cloud Run deployment
README.md SHALL include documentation for running `infra/deploy-backend.sh`, including:
- The prerequisite that `infra/.env.deploy` must be created by copying `infra/.env.deploy.example` and filling in values.
- The prerequisite that a `helio-google-client-id` secret must exist in Google Secret Manager before the script can run.
- The list of Secret Manager secrets the script references: `helio-db-password`, `helio-google-client-secret`, `helio-google-client-id`.
- The list of variables that must be populated in `infra/.env.deploy`: `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`.

#### Scenario: Operator reads deploy prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find instructions to copy `.env.deploy.example` to `.env.deploy` and fill in `GOOGLE_REDIRECT_URI` and `CORS_ALLOWED_ORIGINS`

#### Scenario: Operator reads Secret Manager prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find the list of Secret Manager secrets required before running `deploy-backend.sh`

### Requirement: README documents log locations
README.md SHALL document where application logs are accessible when running on Cloud Run.

#### Scenario: Operator accesses logs
- **WHEN** an operator needs to view logs for a running Cloud Run service
- **THEN** the README SHALL direct them to Cloud Logging (Google Cloud console) or gcloud CLI

### Requirement: deploy-backend.sh contains no hardcoded environment-specific identifiers
`infra/deploy-backend.sh` SHALL NOT contain any hardcoded environment-specific identifier values (OAuth Client IDs, redirect URIs, CORS origins, or other values that vary per deployment target).

#### Scenario: Grep confirms no hardcoded OAuth Client ID
- **WHEN** `grep -E 'GOOGLE_CLIENT_ID=' infra/deploy-backend.sh` is executed
- **THEN** the output SHALL be empty (the variable name may appear as a Secret Manager mapping key but no literal value SHALL be present)

#### Scenario: Script is syntactically valid
- **WHEN** `bash -n infra/deploy-backend.sh` is executed
- **THEN** the exit code SHALL be 0

### Requirement: .env.deploy.example template is committed
`infra/.env.deploy.example` SHALL exist in the repository as a template showing all variables an operator must set in their local `infra/.env.deploy` before running `deploy-backend.sh`.

#### Scenario: Operator copies the example file
- **WHEN** an operator copies `infra/.env.deploy.example` to `infra/.env.deploy` and fills in values
- **THEN** running `infra/deploy-backend.sh` SHALL succeed without any missing-variable errors

### Requirement: .env.deploy is gitignored
`infra/.env.deploy` SHALL be listed in `.gitignore` so that the operator's local deployment configuration file is never committed to the repository.

#### Scenario: Gitignore covers .env.deploy
- **WHEN** `git check-ignore -q infra/.env.deploy` is executed
- **THEN** the exit code SHALL be 0

