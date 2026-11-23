# pipeline-run-deterministic-order Specification

## Purpose
Guarantees that every read listing pipeline runs, picking a pipeline's latest run, or listing a run's assertion
results returns one deterministic order, even when timestamps are equal.

## Requirements

### Requirement: Runs are ordered by start time then id

Every read that lists a pipeline's runs newest-first, or picks a pipeline's latest run (any status, or latest non-dry
run), SHALL order by `started_at` descending and then by run `id` descending. The id tie-break makes the order
deterministic; it does not imply that the higher id is the more recent run.

#### Scenario: Two runs share a start time in run history
- **WHEN** a pipeline has two runs with an identical `started_at`
- **THEN** `GET /api/pipelines/:id/run-history` lists the run with the greater `id` first, on every request

#### Scenario: Latest run agrees across reads
- **WHEN** a pipeline's two newest runs share a `started_at`
- **THEN** `GET /api/pipelines/:id/runs/latest`, the first entry of run-history, and the run whose assertions
  `GET /api/pipelines/context-details` reports are the same run (the greater `id`)

#### Scenario: Latest non-dry run with a tie
- **WHEN** a pipeline's two newest non-dry runs share a `started_at`
- **THEN** assertion-status, panel-status and provenance all read the assertions of the run with the greater `id`

#### Scenario: Reaper agrees with the latest-run rule
- **WHEN** a stale run is reaped and another non-dry run of the same pipeline has the same `started_at` and a greater
  `id`
- **THEN** the reaper does not overwrite the pipeline's `last_run_*`

#### Scenario: Retention with tied start times
- **WHEN** a retention pass keeps the N newest runs and runs at the boundary share a `started_at`
- **THEN** the kept set is the first N in `(started_at DESC, id DESC)` order

### Requirement: Assertion results are ordered by creation then id

Every read of a run's assertion results SHALL order by `created_at` ascending and then by `id` ascending. Assertion
rows written for a run SHALL have ids whose ascending order is the order the assertions were evaluated.

#### Scenario: Same-key assertions read back in a fixed order
- **WHEN** a run has several assertion rows with an identical `created_at`
- **THEN** run-history, context-details and the per-run assertion reads return them in ascending `id` order on every
  request

#### Scenario: New assertions keep evaluation order
- **WHEN** a run's assertion results are inserted
- **THEN** reading them back returns them in the order they were passed to the insert
