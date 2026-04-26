## Why

The README currently lacks production deployment guidance. Operators deploying Helio to Cloud Run have no reference for required environment variables, Docker image builds,
migration execution, or log locations — forcing them to reverse-engineer the codebase.

## What Changes

- Add a "Running in production" section to README.md covering:
  - All required environment variables with brief descriptions
  - How to build the Docker image
  - How to run database migrations
  - How to deploy to Cloud Run
  - Where logs live

## Capabilities

### New Capabilities
- `production-deployment-docs`: Documents the production deployment process including env vars, Docker build, migrations, Cloud Run deployment, and log access.

### Modified Capabilities
<!-- No existing spec-level behavior changes — this is documentation only. -->

## Impact

- README.md only; no code, API, or schema changes.
- No breaking changes.

## Non-goals

- Automating deployments (CI/CD pipelines)
- Documenting staging or development environments
- Infrastructure-as-code (Terraform, etc.)
