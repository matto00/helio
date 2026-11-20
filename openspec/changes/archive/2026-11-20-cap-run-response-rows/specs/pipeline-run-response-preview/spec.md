## ADDED Requirements

### Requirement: Run-result responses carry a 10-row preview, the total and a cut flag
Every response that carries a run result (`POST /api/pipelines/:id/run` with or without `dry=true`, the `run` of
`POST /api/pipelines/apply-proposal`, the run inside `POST /api/proposals/apply`, every `preview` of
`POST /api/pipelines/:id/preview`, and `GET /api/pipelines/:id/steps/:stepId/preview`) SHALL return in `rows` at most the first 10 rows of the frame it reports, in the
frame's order. `rowCount` SHALL be the frame's total row count. A boolean `rowsTruncated` SHALL always be present and
SHALL be `true` exactly when `rowCount` is greater than the number of rows in `rows`. What a run computes and writes
(node snapshots, history, Output rows, `last_run_*`) SHALL NOT change.

#### Scenario: A run with more than 10 terminal rows returns a preview
- **WHEN** `POST /api/pipelines/:id/run` succeeds and the terminal frame has 25 rows
- **THEN** `rows` holds the frame's first 10 rows, `rowCount` is 25 and `rowsTruncated` is `true`
- **AND** the Output's persisted rows (`GET /api/outputs/:id/rows`) hold all 25 rows

#### Scenario: A run with 10 or fewer rows is not marked truncated
- **WHEN** a run's terminal frame has 10 rows
- **THEN** `rows` holds all 10 rows, `rowCount` is 10 and `rowsTruncated` is `false`

#### Scenario: A dry run is capped the same way
- **WHEN** `POST /api/pipelines/:id/run?dry=true` succeeds with 25 terminal rows
- **THEN** `rows` holds 10 rows, `rowCount` is 25 and `rowsTruncated` is `true`

#### Scenario: Both apply endpoints embed the capped run
- **WHEN** `POST /api/pipelines/apply-proposal` or `POST /api/proposals/apply` succeeds and the run has 25 terminal rows
- **THEN** the embedded run's `rows` holds 10 rows, `rowCount` is 25 and `rowsTruncated` is `true`

#### Scenario: The saved-step preview reports its cut
- **WHEN** `POST /api/pipelines/:id/preview` previews a node with 25 rows
- **THEN** that preview's `rows` holds 10 rows, `rowCount` is 25 and `rowsTruncated` is `true`

#### Scenario: The single-step preview reports its cut
- **WHEN** `GET /api/pipelines/:id/steps/:stepId/preview` previews a step with 25 rows
- **THEN** `rows` holds 10 rows, `rowCount` is 25 and `rowsTruncated` is `true`

### Requirement: The web client counts a run from rowCount
The pipeline page's run status SHALL display a finished run's row count from the response's `rowCount`, never from
the number of rows in `rows`. When a run settles with no run response in hand (a Save & run), the count SHALL still not
be claimed.

#### Scenario: A large run shows its full count
- **WHEN** a manual run's response has `rowCount` 25 and 10 preview rows
- **THEN** the run status reads "Snapshot replaced: 25 rows" (a dry run reads "Preview: 25 rows")

### Requirement: The MCP apply tools pass the capped run through and say so
`apply_pipeline_proposal` and `apply_combined_proposal` SHALL return the backend's run result unchanged, including
`rowCount` and `rowsTruncated`. Each tool's description SHALL state that the run's `rows` is a preview of at most 10
rows, that `rowCount` is the total and `rowsTruncated` marks the cut, and that `get_output_rows` returns the full data.

#### Scenario: An agent sees the total and the cut
- **WHEN** an agent applies a proposal whose run has 25 terminal rows
- **THEN** the tool result's run carries 10 rows, `rowCount` 25 and `rowsTruncated` `true`

### Requirement: Client and MCP are held to the server's run-result body by a shared fixture
A backend test SHALL hold the body of a real `POST /api/pipelines/:id/run` with more than 10 terminal rows to a fixture
under `shared-test-fixtures/`, and the web client and the MCP server tests SHALL read that same fixture.

#### Scenario: The server body and the fixture agree
- **WHEN** the backend test runs a pipeline with more than 10 terminal rows through the real route
- **THEN** it fails if the body's `rows` length, `rowCount` or `rowsTruncated` differ from the fixture
