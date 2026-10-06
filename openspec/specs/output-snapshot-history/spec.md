# output-snapshot-history Specification

## Purpose
Records a compact per-Output summary of every real, successful pipeline run so later features can show deltas, sparklines and alert baselines over an Output's history.

## Requirements

### Requirement: Output history storage
The system SHALL store per-Output history points in `output_snapshot_history`, keyed by a UUID primary key, referencing `outputs(id)` with `ON DELETE CASCADE`, and carrying `pipeline_id`, `node_step_id`, `root_id`, a nullable `run_id` with no foreign key, `trigger_source`, `captured_at`, `row_count` and a JSONB `summary`, indexed on `(output_id, captured_at DESC)`.

#### Scenario: Deleting an Output removes its history
- **WHEN** an Output with recorded history points is deleted
- **THEN** every `output_snapshot_history` row for that Output is removed by the cascade

#### Scenario: run id survives run-row pruning
- **WHEN** the `pipeline_runs` row a history point names has been pruned or never existed
- **THEN** the history point remains and its `run_id` still holds the run's id text

### Requirement: Output history row-level security
`output_snapshot_history` SHALL have row-level security enabled and forced, with select, insert, update and delete policies on `helio_can_access_pipeline(pipeline_id)`, and SHALL grant SELECT, INSERT, UPDATE and DELETE to `helio_privileged` explicitly.

#### Scenario: Owner and grantee can read, others cannot
- **WHEN** a non-BYPASSRLS role reads history with the user context set to the pipeline owner or to a user the pipeline is shared with
- **THEN** the history rows are visible
- **WHEN** the user context is a user with no access to the pipeline
- **THEN** zero rows are visible

#### Scenario: Insert without user context is rejected
- **WHEN** a non-BYPASSRLS role inserts a history row with no user context set
- **THEN** the insert is rejected by the row-level security policy

#### Scenario: Migration applies under a non-superuser Flyway role
- **WHEN** the migrations run as a non-BYPASSRLS role
- **THEN** the history migration applies successfully

### Requirement: Only real unblocked successful runs record history
The system SHALL write exactly one history point per Output on each materialized node of a real, unblocked, successful pipeline run, and SHALL write none for dry runs, blocked runs, failed runs, runs whose write-back fails, or the Output backfill that materializes a newly bound node.

#### Scenario: Two real runs
- **WHEN** a pipeline with one Output completes two real successful runs
- **THEN** that Output has two history points, each carrying its run's id and trigger source

#### Scenario: Excluded run kinds
- **WHEN** a dry run, a blocked run, a failed run, a write-back failure, or an Output backfill occurs
- **THEN** no history point is written

### Requirement: History is written atomically with the snapshot replace
The history insert for a node SHALL run in the same database transaction as that node's snapshot replace, and a failing history insert SHALL roll back the snapshot replace.

#### Scenario: Failing history insert
- **WHEN** the history insert for a node fails
- **THEN** that node's previous snapshot rows are left unchanged

### Requirement: Summary reducer matches the frontend aggregation
The history summary SHALL contain the row count, per-numeric-column count/sum/min/max for at most 20 columns, the headline value for metric Outputs, and the x→y series for chart Outputs reduced to at most 200 points, computed with the same numeric coercion and aggregation semantics as the frontend `computeAggregate` and `groupAndAggregate`. A column statistic's `count` SHALL be the number of cells coercible to a finite number, not the number of non-null cells.

#### Scenario: Shared fixtures agree
- **WHEN** the backend reducer and the frontend aggregation functions evaluate the same shared fixture cases, including numeric strings, blank strings, hex/binary/octal literals, exponent forms, non-finite literals, booleans, nulls and absent fields
- **THEN** both produce identical results

#### Scenario: Metric over all rows
- **WHEN** a metric Output with an aggregation summarizes a node with more rows than the dashboard's first page
- **THEN** the stored headline value is the aggregate over all rows

#### Scenario: Large chart series
- **WHEN** a chart Output's series has more than 200 points
- **THEN** the stored series holds at most 200 points including the first and last, with the original point count recorded

### Requirement: History repository primitives
The history repository SHALL provide listing the most recent points of an Output newest first, finding the nearest point at or before an instant, finding the earliest point's timestamp, and thinning plus purging history by age-dependent time buckets and per-tier maximum age, where the tier is the tier of the owner of the history point's pipeline and a tier absent from the supplied caps (including a tier unknown to the code) uses the strictest (shortest) supplied cap. Concurrent thinning/purge passes SHALL NOT run simultaneously, and a pass SHALL NOT wait on the retention lock: a pass that finds the retention lock held (by another retention pass, or shared by a run's write-time payload trim) deletes nothing and reports a lock-held skip that is distinguishable from a pass that ran and deleted nothing.

#### Scenario: Nearest point at or before
- **WHEN** points exist at t1 < t2 < t3 and the lookup instant falls between t2 and t3
- **THEN** the point at t2 is returned, and no point is returned for an instant before t1

#### Scenario: Thinning keeps the newest point per bucket
- **WHEN** several points fall in the same age-dependent bucket
- **THEN** only the newest point in that bucket remains, points older than the pipeline owner's tier maximum age are deleted, and a second thinning pass deletes nothing

#### Scenario: Tier missing from the caps falls back to the strictest cap
- **WHEN** the caps name only some tiers and a pipeline owner's tier is not among them
- **THEN** that owner's history points older than the shortest supplied cap are deleted

#### Scenario: A pass that finds another in progress deletes nothing
- **WHEN** another session holds the retention lock (exclusively or shared) and thinning is invoked with thinnable points present
- **THEN** it reports a lock-held skip (not a zero-delete result) and no point is deleted, and a later pass after the lock is released thins them

#### Scenario: A tier unknown to the code is still age-purged
- **WHEN** the caps name some tiers and a pipeline owner has a tier not among them, even one the code has never heard of
- **THEN** that owner's points older than the shortest supplied cap are deleted

### Requirement: Metric field selection never picks a label or unit mapping
The history summary's metric field SHALL resolve to the config's `fieldMapping.value` when it is a non-empty string,
otherwise to `aggregation.value` when it is a non-empty string, otherwise to no field. A `fieldMapping.label` or
`fieldMapping.unit` entry SHALL never be selected as the metric field, whether or not it is the only mapping. With no
field, the summary's `metric` SHALL be `null`. The client's mirror of this rule SHALL resolve identically.

#### Scenario: Aggregated metric with a mapped label
- **WHEN** a metric Output's config is `fieldMapping: {label: "region"}` and `aggregation: {value: "amount", agg: "sum"}`
- **THEN** the stored summary metric is `{field: "amount", agg: "sum", value: <sum of amount>}`, never computed over `region`

#### Scenario: Lone label mapping with no metric field
- **WHEN** a metric Output's config is `fieldMapping: {label: "region"}` with no `fieldMapping.value` and no `aggregation.value`
- **THEN** the stored summary's `metric` is `null`, not `0`

#### Scenario: Lone unit mapping with no metric field
- **WHEN** a metric Output's config is `fieldMapping: {unit: "currency"}` and `aggregation: {agg: "sum"}` with no value
- **THEN** the stored summary's `metric` is `null`

#### Scenario: Client resolves identically
- **WHEN** the client resolves the metric field for any of the configs above
- **THEN** it returns the same field as the server, or no field where the server stores `null`
