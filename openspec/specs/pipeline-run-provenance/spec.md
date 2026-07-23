# pipeline-run-provenance Specification

## Purpose
Persist and surface which path triggered each pipeline run (manual, scheduled, or external) so
Run History can show provenance per run.
## Requirements
### Requirement: pipeline_runs persists a trigger source
The `pipeline_runs` table SHALL have a `trigger_source` column constrained to `manual`,
`scheduled`, or `external`, defaulting to `manual`. The default SHALL apply to both newly inserted
rows that do not specify a value and to pre-existing rows from before the column was added.

#### Scenario: Fresh migration backfills existing rows to manual
- **WHEN** the `V63` migration runs against a database with pre-existing `pipeline_runs` rows
- **THEN** every pre-existing row has `trigger_source = 'manual'`

#### Scenario: Invalid trigger source is rejected
- **WHEN** an insert or update attempts to set `trigger_source` to a value other than `manual`,
  `scheduled`, or `external`
- **THEN** the database rejects the write via the CHECK constraint

### Requirement: Manual run submission persists trigger_source = manual
`POST /api/pipelines/:id/run` (non-dry and dry) SHALL persist the submitted run's
`trigger_source` as `manual`.

#### Scenario: Manual run recorded as manual
- **WHEN** a user submits `POST /api/pipelines/:id/run` (non-dry)
- **THEN** the resulting `pipeline_runs` row has `trigger_source = 'manual'`

#### Scenario: Manual dry run recorded as manual
- **WHEN** a user submits `POST /api/pipelines/:id/run?dry=true`
- **THEN** the resulting `pipeline_runs` row has `trigger_source = 'manual'`

### Requirement: Run history response includes triggerSource
`GET /api/pipelines/:id/run-history` SHALL include a `triggerSource` field
(`"manual" | "scheduled" | "external"`) on every run record, reflecting the persisted
`trigger_source` value.

#### Scenario: Run history response includes triggerSource per run
- **WHEN** `GET /api/pipelines/:id/run-history` is called for a pipeline with existing runs
- **THEN** each run object in the response includes a `triggerSource` field matching its
  persisted `trigger_source`

### Requirement: Run History UI shows provenance per run
The pipeline Run History view SHALL display each run's trigger source (manual, scheduled, or
external) alongside its existing status, timing, and row-count information.

#### Scenario: Manual run shows a manual badge
- **WHEN** a run record with `triggerSource: "manual"` is rendered in Run History
- **THEN** the row displays a "Manual" provenance indicator

#### Scenario: Scheduled run shows a scheduled badge
- **WHEN** a run record with `triggerSource: "scheduled"` is rendered in Run History
- **THEN** the row displays a "Scheduled" provenance indicator

