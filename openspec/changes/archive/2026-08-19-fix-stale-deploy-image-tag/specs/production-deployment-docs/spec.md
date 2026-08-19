## ADDED Requirements

### Requirement: deploy-backend.sh requires an explicit image tag

`infra/deploy-backend.sh` SHALL NOT contain any hardcoded or default container
image tag. It SHALL require the caller to supply an `--image=<value>` flag
(via its existing `"$@"` passthrough) and SHALL exit non-zero, before invoking
`gcloud run deploy`, with guidance on how to determine the correct tag, when
no `--image=` flag is present in its arguments.

#### Scenario: Script refuses to run without an explicit image
- **WHEN** `infra/deploy-backend.sh` is invoked with no `--image=` flag among its arguments
- **THEN** it SHALL exit non-zero without invoking `gcloud run deploy`, and SHALL print guidance for determining the correct image tag

#### Scenario: Script proceeds when an explicit image is provided
- **WHEN** `infra/deploy-backend.sh` is invoked with an `--image=<value>` flag among its arguments
- **THEN** it SHALL invoke `gcloud run deploy` with that image

#### Scenario: No hardcoded image tag remains
- **WHEN** `grep -E -- '--image=us-west1-docker' infra/deploy-backend.sh` is executed
- **THEN** the output SHALL be empty (no hardcoded image reference remains in the script)

## MODIFIED Requirements

### Requirement: README documents Cloud Run deployment

README.md SHALL include documentation for running `infra/deploy-backend.sh`, including:
- The prerequisite that `infra/.env.deploy` must be created by copying `infra/.env.deploy.example` and filling in values.
- The list of Secret Manager secrets the script references: `helio-db-password`, `helio-google-client-secret`.
- The list of variables that must be populated in `infra/.env.deploy`: `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`.
- That the backend connects to Cloud SQL over a Serverless VPC Access connector + Private IP (not the `postgres-socket-factory` connector library), including the prerequisite that the VPC connector and Cloud SQL Private IP peering already exist before the script can deploy successfully.
- That the script requires an explicit `--image=<full-image-path:tag>` flag (it hardcodes no default image tag), that this script is a manual/bootstrap deploy path distinct from the automated `cd-backend.yml` CD pipeline (which builds and deploys a fresh git-sha-tagged image on every push to `release/**`), and how to determine the correct tag to pass — either the currently-live tag (via `gcloud run services describe`) or a CI-built tag for a specific commit (via the matching `cd-backend.yml` run).

#### Scenario: Operator reads deploy prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find instructions to copy `.env.deploy.example` to `.env.deploy` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, and `CORS_ALLOWED_ORIGINS`

#### Scenario: Operator reads Secret Manager prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find the list of Secret Manager secrets required before running `deploy-backend.sh`

#### Scenario: Operator reads private networking prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find that the backend requires a Serverless VPC Access connector and Cloud SQL Private IP already provisioned, and SHALL NOT find any remaining reference to the `postgres-socket-factory`/`cloudSqlInstance` connector path as the primary connectivity method

#### Scenario: Operator reads the explicit image tag requirement
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find that `--image=<full-image-path:tag>` is a required flag, that the script is a manual/bootstrap path distinct from the automated `cd-backend.yml` CD pipeline, and how to determine the correct tag to pass
