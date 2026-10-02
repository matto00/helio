## MODIFIED Requirements

### Requirement: README documents Cloud Run deployment

README.md SHALL include documentation for running `infra/deploy-backend.sh`, including:
- The prerequisite that `infra/.env.deploy` must be created by copying `infra/.env.deploy.example` and filling in values.
- The list of Secret Manager secrets the script references: `helio-db-password`, `helio-google-client-secret`.
- The list of variables that must be populated in `infra/.env.deploy`: `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`.
- That the backend connects to Cloud SQL over Cloud Run Direct VPC egress (`--network` / `--subnet`, `--vpc-egress=private-ranges-only`) + Private IP (not a Serverless VPC Access connector and not the `postgres-socket-factory` connector library), including the prerequisite that the egress subnet (name and range) and Cloud SQL Private IP peering already exist before the script can deploy successfully.
- That the script requires an explicit `--image=<full-image-path:tag>` flag (it hardcodes no default image tag), that this script is a manual/bootstrap deploy path distinct from the automated `cd-backend.yml` CD pipeline (which builds and deploys a fresh git-sha-tagged image on every push to `release/**`), and how to determine the correct tag to pass — either the currently-live tag (via `gcloud run services describe`) or a CI-built tag for a specific commit (via the matching `cd-backend.yml` run).

#### Scenario: Operator reads deploy prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find instructions to copy `.env.deploy.example` to `.env.deploy` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, and `CORS_ALLOWED_ORIGINS`

#### Scenario: Operator reads Secret Manager prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find the list of Secret Manager secrets required before running `deploy-backend.sh`

#### Scenario: Operator reads private networking prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find that the backend requires the Direct VPC egress subnet and Cloud SQL Private IP already provisioned, and SHALL NOT find a Serverless VPC Access connector or the `postgres-socket-factory`/`cloudSqlInstance` connector path described as the current or primary connectivity method (a reference to the connector in a rollback or history context is permitted)

#### Scenario: Operator reads the explicit image tag requirement
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find that `--image=<full-image-path:tag>` is a required flag, that the script is a manual/bootstrap path distinct from the automated `cd-backend.yml` CD pipeline, and how to determine the correct tag to pass

#### Scenario: Operator reads the cutover and rollback runbook
- **WHEN** an operator reads docs/deployment.md
- **THEN** they SHALL find an ordered, command-level runbook for moving the live service from the connector to Direct VPC egress (no-traffic tagged revision on the live image, verification, traffic shift, rollback, later connector deletion) and the criteria under which re-provisioning the connector is justified
