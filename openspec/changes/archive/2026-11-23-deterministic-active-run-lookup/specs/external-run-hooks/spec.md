## MODIFIED Requirements

### Requirement: Duplicate external triggers collapse into the in-flight run
The system SHALL NOT start a second run when `POST /api/hooks/run` is called for a pipeline that
already has an in-flight (not yet completed) run; it SHALL instead return `200 OK` with the
in-flight run's `runId` and its current status. When the pipeline has more than one in-flight run
(overlapping manual submits remain allowed), the run returned SHALL be the first in
`(started_at DESC, id DESC)` order, on every request. The `id` tie-break makes the choice
deterministic; it does not imply that the higher id is the more recent run.

#### Scenario: Retry while a triggered run is still executing
- **WHEN** `POST /api/hooks/run` is called for a pipeline that already has an incomplete run
- **THEN** the system returns `200 OK` with the existing run's `runId` rather than inserting a new
  `pipeline_runs` row

#### Scenario: Several in-flight runs collapse into the newest
- **WHEN** a pipeline has two incomplete runs with different `started_at` and `POST /api/hooks/run` is called
- **THEN** the response's `runId` is the run with the later `started_at`, whichever run was inserted first

#### Scenario: In-flight runs with tied start times
- **WHEN** a pipeline has two incomplete runs with an identical `started_at`
- **THEN** every call returns the run with the greater `id`, whichever run was inserted first
