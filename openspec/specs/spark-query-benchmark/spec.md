# spark-query-benchmark Specification

## Purpose
TBD - created by archiving change spark-query-optimization. Update Purpose after archive.
## Requirements
### Requirement: Benchmark suite measures p95 panel query latency for representative scenarios
The system SHALL provide a `SparkBenchmarkSpec` ScalaTest suite that creates a local `SparkSession` and
measures wall-clock p95 execution latency (n=20 timed samples after 5 warm-up runs) for the following
scenarios: simple column projection (10k rows), filter+sort (10k rows), aggregation (100k rows), and
paginated query (100k rows, page 1 of 10).

#### Scenario: Simple projection p95 is under 2 seconds
- **WHEN** `SparkBenchmarkSpec` runs the simple-projection scenario (select 2 columns from 10k rows) 20 times
- **THEN** the p95 latency value is less than 2000 milliseconds

#### Scenario: Filter and sort p95 is under 2 seconds
- **WHEN** `SparkBenchmarkSpec` runs the filter+sort scenario (filter on numeric column, sort descending, 10k rows) 20 times
- **THEN** the p95 latency value is less than 2000 milliseconds

#### Scenario: Aggregation p95 is under 2 seconds
- **WHEN** `SparkBenchmarkSpec` runs the aggregation scenario (group-by + sum on 100k rows) 20 times
- **THEN** the p95 latency value is less than 2000 milliseconds

#### Scenario: Paginated query p95 is under 2 seconds
- **WHEN** `SparkBenchmarkSpec` runs the pagination scenario (page 1 of 10, pageSize=10, 100k rows) 20 times
- **THEN** the p95 latency value is less than 2000 milliseconds

### Requirement: Benchmark suite logs query plan for each scenario
The system SHALL capture and log `df.explain(extended = true)` output for each benchmark scenario once
(outside the timed loop) so the physical and logical plan is visible in test output.

#### Scenario: Explain output appears in test log for every scenario
- **WHEN** `SparkBenchmarkSpec` runs any scenario
- **THEN** the test log contains an `== Physical Plan ==` section for that scenario before timing results are printed

### Requirement: Benchmark suite uses a shared local SparkSession
The system SHALL create a single `SparkSession` with `master("local[*]")` in `beforeAll` and stop it in
`afterAll`, shared across all scenarios in `SparkBenchmarkSpec`.

#### Scenario: SparkSession is created once per suite run
- **WHEN** `SparkBenchmarkSpec` runs with multiple scenarios
- **THEN** only one SparkSession is started (no duplicate context warnings in logs)

