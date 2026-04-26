# production-deployment-docs Specification

## Purpose
TBD - created by archiving change document-prod-env-vars. Update Purpose after archive.
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
README.md SHALL include the gcloud command to deploy the backend to Cloud Run with the required environment variable flags.

#### Scenario: Operator deploys to Cloud Run
- **WHEN** an operator follows the Cloud Run deployment instructions in README.md
- **THEN** they SHALL be able to deploy the service with the documented gcloud run deploy command

### Requirement: README documents log locations
README.md SHALL document where application logs are accessible when running on Cloud Run.

#### Scenario: Operator accesses logs
- **WHEN** an operator needs to view logs for a running Cloud Run service
- **THEN** the README SHALL direct them to Cloud Logging (Google Cloud console) or gcloud CLI

