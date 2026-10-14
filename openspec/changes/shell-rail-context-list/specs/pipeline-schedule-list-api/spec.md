## Purpose

List the caller's scheduled pipelines, and the sources that feed them, in one request so the shell can show scheduled
items and their next run without one request per pipeline or per source.

## ADDED Requirements

### Requirement: List the caller's enabled pipeline schedules
`GET /api/pipeline-schedules` SHALL return `items: [{pipelineId, pipelineName, kind, expression, timezone, nextRunAt,
lastRunAt}]` for every enabled schedule on a pipeline the caller owns (the same ownership rule as
`GET /api/pipelines/:id/schedule`), ordered by `nextRunAt` ascending with nulls last, then pipeline name. Disabled
schedules and other users' schedules SHALL NOT appear. The response SHALL be produced without a database query per
pipeline or per source.

#### Scenario: Only the caller's enabled schedules
- **WHEN** the caller owns pipelines P1 (enabled schedule) and P2 (disabled), and another user owns P3 (enabled)
- **THEN** `items` lists only P1

#### Scenario: Empty list
- **WHEN** the caller has no schedules
- **THEN** the response is 200 with `items: []` and `sources: []`

### Requirement: Sources feeding a scheduled pipeline, with the soonest run
The same response SHALL include `sources: [{sourceId, sourceName, nextRunAt, pipelineId, pipelineName}]`: one entry per
distinct data source that is a root of at least one pipeline listed in `items` and that the caller can access, carrying
the earliest non-null `nextRunAt` among those pipelines and that pipeline's id and name (nulls only when every feeding
pipeline's `nextRunAt` is null; ties broken by pipeline name). Entries SHALL be ordered like `items`.

#### Scenario: A source feeding several scheduled pipelines shows the soonest run
- **WHEN** source S is a root of the caller's scheduled pipelines A (next 14:00) and B (next 09:00)
- **THEN** `sources` contains S exactly once, with `nextRunAt` 09:00 and pipeline B

#### Scenario: A source feeding only disabled schedules is absent
- **WHEN** source T feeds only a pipeline whose schedule is disabled
- **THEN** `sources` does not contain T
