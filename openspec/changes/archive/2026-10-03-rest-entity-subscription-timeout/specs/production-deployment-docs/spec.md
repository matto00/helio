## ADDED Requirements

### Requirement: Backend deploys keep CPU always allocated
The production backend deploy paths (the CD workflow and the manual deploy script) SHALL explicitly pass `--no-cpu-throttling`, and the deployment documentation SHALL state why: background scheduled pipeline runs, auto-run and rollups execute between requests and need CPU outside request handling, accepting instance-time billing.

#### Scenario: CD flags carry the setting
- **WHEN** the CD backend workflow's deploy flags are inspected
- **THEN** they contain `--no-cpu-throttling`, and a static guard fails if it is removed

#### Scenario: Manual deploy script carries the setting
- **WHEN** `infra/deploy-backend.sh` is inspected
- **THEN** its `gcloud run deploy` invocation includes `--no-cpu-throttling`
