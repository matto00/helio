# pipeline-dry-run-ui Specification

## Purpose
TBD - created by archiving change dry-run-mode. Update Purpose after archive.
## Requirements
### Requirement: Pipeline detail page exposes a "Dry run" button
The pipeline detail page footer SHALL include a "Dry run" secondary button rendered to the left
of the existing "Run pipeline" button. Clicking it SHALL dispatch `submitPipelineRun` with
`dryRun: true`. The button SHALL be disabled while `runStatus` is `"queued"` or `"running"`.

#### Scenario: Dry run button is visible on pipeline detail page
- **WHEN** the user navigates to a pipeline detail page
- **THEN** a button labelled "Dry run" is visible in the footer alongside the "Run pipeline" button

#### Scenario: Clicking "Dry run" dispatches run with dryRun flag
- **WHEN** the user clicks the "Dry run" button
- **THEN** `submitPipelineRun` is dispatched with `{ pipelineId: id, dryRun: true }`

#### Scenario: Dry run button disabled during active run
- **WHEN** `runStatus` is `"queued"` or `"running"`
- **THEN** the "Dry run" button is disabled

### Requirement: Run history panel shows dry-run rows with a distinct badge
The `StatusBadge` component and the `PipelineRunRecord.status` type SHALL support `"dry_run"` as
a valid status value. A dry-run row in the history panel SHALL render the badge text "Dry run" and
use a distinct muted visual style (CSS class `pipeline-detail-page__run-status--dry_run`).

#### Scenario: Dry-run row appears in run history with "Dry run" badge
- **WHEN** the run history panel renders a `PipelineRunRecord` with `status = "dry_run"`
- **THEN** the status badge displays the text "Dry run" with the CSS modifier `--dry_run`

#### Scenario: Dry-run row shows row count when available
- **WHEN** a dry-run record has `rowCount = 42`
- **THEN** the history row displays "42 rows"

### Requirement: submitPipelineRun thunk accepts an optional dryRun flag
The `submitPipelineRun` async thunk SHALL accept `{ pipelineId: string; dryRun?: boolean }` as
its argument. When `dryRun` is `true` the thunk SHALL call the pipeline service with the dry-run
flag, which appends `?dry=true` to the request URL.

#### Scenario: submitPipelineRun with dryRun true calls service with dry flag
- **WHEN** `submitPipelineRun({ pipelineId: "p1", dryRun: true })` is dispatched
- **THEN** the HTTP request is `POST /api/pipelines/p1/run?dry=true`

#### Scenario: submitPipelineRun without dryRun calls service without flag
- **WHEN** `submitPipelineRun({ pipelineId: "p1" })` is dispatched (no dryRun)
- **THEN** the HTTP request is `POST /api/pipelines/p1/run` with no query param

