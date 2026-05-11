## ADDED Requirements

### Requirement: PipelineDetailPage shows persistent last-run metadata bar
`PipelineDetailPage` SHALL render a metadata bar displaying the persisted last-run information from
`currentPipeline`: relative timestamp, row count (locale-formatted), and status badge. The bar
SHALL appear only when `currentPipeline.lastRunAt` is non-null. When `lastRunAt` is null the bar
SHALL be absent and no "Never run" placeholder is shown in the metadata area (the never-run state
is communicated in the list view).

#### Scenario: Metadata bar is visible when pipeline has run
- **WHEN** `currentPipeline.lastRunAt` is a non-null ISO-8601 string
- **THEN** a metadata bar is rendered showing the relative timestamp, row count, and status

#### Scenario: Metadata bar is absent when pipeline has never run
- **WHEN** `currentPipeline.lastRunAt` is null
- **THEN** no metadata bar element is rendered

#### Scenario: Metadata bar shows relative timestamp
- **WHEN** the metadata bar is rendered
- **THEN** the last-run time is displayed in relative format (e.g. "2 hours ago")

#### Scenario: Metadata bar shows row count
- **WHEN** `currentPipeline.lastRunRowCount` is non-null
- **THEN** the count is shown with locale formatting (e.g. "4,200 rows")

#### Scenario: Metadata bar shows status badge
- **WHEN** `currentPipeline.lastRunStatus` is "succeeded" or "failed"
- **THEN** the appropriate status badge is rendered in the metadata bar
