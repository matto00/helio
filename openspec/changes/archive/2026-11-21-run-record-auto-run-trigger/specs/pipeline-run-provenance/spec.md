## MODIFIED Requirements

### Requirement: pipeline_runs persists a trigger source
The `pipeline_runs` table SHALL have a `trigger_source` column constrained to `manual`,
`scheduled`, `external`, or `auto-run` (HEL-1093, V110), defaulting to `manual`. The default SHALL apply to both
newly inserted rows that do not specify a value and to pre-existing rows from before the column was added.

#### Scenario: Fresh migration backfills existing rows to manual
- **WHEN** the `V63` migration runs against a database with pre-existing `pipeline_runs` rows
- **THEN** every pre-existing row has `trigger_source = 'manual'`

#### Scenario: Invalid trigger source is rejected
- **WHEN** an insert or update attempts to set `trigger_source` to a value other than `manual`,
  `scheduled`, `external`, or `auto-run`
- **THEN** the database rejects the write via the CHECK constraint

### Requirement: Run history response includes triggerSource
`GET /api/pipelines/:id/run-history` SHALL include a `triggerSource` field
(`"manual" | "scheduled" | "external" | "auto-run"`) on every run record, reflecting the persisted
`trigger_source` value. Every record the route writes SHALL validate against
`schemas/pipelines/pipeline-run-record.schema.json`, whose `triggerSource` enum lists exactly those four values. `completedAt`, `rowCount` and `errorLog` are omitted
from a record when unset, and the schema does not require them.

#### Scenario: Run history response includes triggerSource per run
- **WHEN** `GET /api/pipelines/:id/run-history` is called for a pipeline with existing runs
- **THEN** each run object in the response includes a `triggerSource` field matching its
  persisted `trigger_source`

#### Scenario: An auto-run record validates against the run-record schema
- **WHEN** a pipeline has one persisted run per trigger source, including `auto-run`, and
  `GET /api/pipelines/:id/run-history` is called
- **THEN** every returned record validates against `pipeline-run-record.schema.json`
- **AND** the body matches the shared fixture `shared-test-fixtures/pipeline-run/run-history-response.json` that the
  web-client contract test reads

#### Scenario: A succeeded run with no error and an unfinished run validate
- **WHEN** the run history holds a succeeded run with no `errorLog` and a queued or running run with no
  `completedAt` or `rowCount`
- **THEN** those records omit the unset fields and still validate against the schema

### Requirement: Run History UI shows provenance per run
The pipeline Run History view SHALL display each run's trigger source (manual, scheduled, external, or auto-run)
alongside its existing status, timing, and row-count information. The home run timeline SHALL label a run's trigger
source with the same wording.

#### Scenario: Manual run shows a manual badge
- **WHEN** a run record with `triggerSource: "manual"` is rendered in Run History
- **THEN** the row displays a "Manual" provenance indicator

#### Scenario: Scheduled run shows a scheduled badge
- **WHEN** a run record with `triggerSource: "scheduled"` is rendered in Run History
- **THEN** the row displays a "Scheduled" provenance indicator

#### Scenario: Auto-run shows an Auto-run label in Run History and on the home timeline
- **WHEN** a run with `triggerSource: "auto-run"` is rendered in Run History or as a home timeline mark's details
- **THEN** it displays "Auto-run", never the raw value or a generic fallback
