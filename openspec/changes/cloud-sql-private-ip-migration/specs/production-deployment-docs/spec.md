## MODIFIED Requirements

### Requirement: README documents Cloud Run deployment

README.md SHALL include documentation for running `infra/deploy-backend.sh`, including:
- The prerequisite that `infra/.env.deploy` must be created by copying `infra/.env.deploy.example` and filling in values.
- The list of Secret Manager secrets the script references: `helio-db-password`, `helio-google-client-secret`.
- The list of variables that must be populated in `infra/.env.deploy`: `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, `CORS_ALLOWED_ORIGINS`.
- That the backend connects to Cloud SQL over a Serverless VPC Access connector + Private IP (not the `postgres-socket-factory` connector library), including the prerequisite that the VPC connector and Cloud SQL Private IP peering already exist before the script can deploy successfully.

#### Scenario: Operator reads deploy prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find instructions to copy `.env.deploy.example` to `.env.deploy` and fill in `GOOGLE_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, and `CORS_ALLOWED_ORIGINS`

#### Scenario: Operator reads Secret Manager prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find the list of Secret Manager secrets required before running `deploy-backend.sh`

#### Scenario: Operator reads private networking prerequisites
- **WHEN** an operator reads the Cloud Run deployment section of infra/README.md
- **THEN** they SHALL find that the backend requires a Serverless VPC Access connector and Cloud SQL Private IP already provisioned, and SHALL NOT find any remaining reference to the `postgres-socket-factory`/`cloudSqlInstance` connector path as the primary connectivity method
