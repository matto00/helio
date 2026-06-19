## MODIFIED Requirements

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

## ADDED Requirements

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
