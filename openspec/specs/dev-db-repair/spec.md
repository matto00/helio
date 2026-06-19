# dev-db-repair Specification

## Purpose
Provide an idempotent SQL repair script and documentation for correcting dev-database drift introduced by ACL ownership changes (NULL-owner rows, wrong-owner DataTypes, empty join-step config, SystemUser-owned pipelines), so the seeded ProfitAgg pipeline runs without a 422 and panels can bind to its output.
## Requirements
### Requirement: Dev DB repair script exists and is idempotent
The repository SHALL include `backend/scripts/repair-dev-db.sql` — a SQL script that corrects four categories of drift in an existing dev installation: NULL-owner DataType rows, wrong-owner ProfitAgg output DataType, empty ProfitAgg join step config, and wrong-owner ProfitAgg pipeline row. All operations SHALL be guarded so the script is safe to run on a DB that is already in the correct state.

#### Scenario: Script backfills NULL-owner DataType rows
- **WHEN** `repair-dev-db.sql` is executed against a dev DB containing DataType rows with `owner_id IS NULL`
- **THEN** all such rows have their `owner_id` set to `9532cfcf-9882-45ba-8247-23706bc00113` (matt@helio.dev)

#### Scenario: Script corrects wrong-owner ProfitAgg output DataType
- **WHEN** `repair-dev-db.sql` is executed and DataType `c1005183-0cbe-4631-ac62-95421e18f0a5` has an `owner_id` that is not `9532cfcf-9882-45ba-8247-23706bc00113`
- **THEN** that row's `owner_id` is updated to `9532cfcf-9882-45ba-8247-23706bc00113`

#### Scenario: Script repairs empty join-step config
- **WHEN** `repair-dev-db.sql` is executed and pipeline_step `9607c209-421c-48b9-b4f2-1cb72b103092` has config `{}`
- **THEN** the config is updated to include `rightDataSourceId`, `joinKey`, and `joinType` pointing at DataSource `339018f2-3760-415d-baeb-35d2e3061992` ("Profit")

#### Scenario: Script corrects ProfitAgg pipeline ownership
- **WHEN** `repair-dev-db.sql` is executed and the ProfitAgg pipeline (`6c75e682-...`) has `owner_id = '00000000-0000-0000-0000-000000000001'`
- **THEN** `owner_id` is updated to `9532cfcf-9882-45ba-8247-23706bc00113`

#### Scenario: Script is idempotent
- **WHEN** `repair-dev-db.sql` is executed twice on the same database
- **THEN** the second run completes without error and leaves data in the same correct state

### Requirement: ProfitAgg pipeline runs without 422 after repair
After the repair script is applied, a user authenticated as matt@helio.dev (`9532cfcf-...`) SHALL be able to submit a run for the ProfitAgg pipeline and receive a non-422 response.

#### Scenario: ProfitAgg run-submit succeeds
- **WHEN** `POST /api/pipelines/6c75e682-4a7c-469b-b9ba-5fda8e4adc42/run` is called as matt@helio.dev after repair
- **THEN** the response is not 422

### Requirement: Panel binding to ProfitAgg output DataType persists after repair
After repair, a panel owned by matt@helio.dev SHALL be bindable to DataType `c1005183-0cbe-4631-ac62-95421e18f0a5` without the binding being silently scrubbed on the next read.

#### Scenario: Binding persists across read
- **WHEN** a panel's `typeId` is PATCH-set to `c1005183-0cbe-4631-ac62-95421e18f0a5` and then the panel is GET-fetched
- **THEN** the returned `typeId` is `c1005183-0cbe-4631-ac62-95421e18f0a5`, not empty string

### Requirement: Dev DB repair procedure is documented
`backend/README.md` SHALL contain a "Dev DB repair" section explaining when to run the repair script, the exact psql command, and how to verify success.

#### Scenario: Developer finds repair documentation
- **WHEN** a developer encounters the 422 or panel-binding-scrub symptoms described in HEL-267
- **THEN** `backend/README.md` provides a clear, self-contained repair procedure they can follow without prior context

