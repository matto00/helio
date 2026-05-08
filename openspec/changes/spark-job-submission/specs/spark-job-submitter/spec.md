## ADDED Requirements

### Requirement: SparkJobSubmitter translates pipeline steps to DataFrame operations
The `SparkJobSubmitter` service SHALL accept a pipeline (with its source `DataSource`) and an
ordered list of `PipelineStep` records, build a Spark DataFrame transformation chain, submit the
job to the Spark cluster, and update `PipelineRunCache` with status transitions and results.

All six step operations from the `pipeline_steps` schema SHALL be supported:
- `rename` — rename one or more columns; config: `{ "mappings": { "<old>": "<new>", ... } }`
- `filter` — apply a SQL filter expression; config: `{ "expression": "<sql-where-clause>" }`
- `join` — join with another DataFrame; config: `{ "joinKey": "<col>", "dataTypeId": "<id>" }`
- `compute` — add a computed column; config: `{ "column": "<name>", "expression": "<sql-expr>" }`
- `groupby` — group and aggregate; config: `{ "groupByColumns": ["<col>", ...], "aggregations": [{ "column": "<col>", "function": "sum|count|avg|min|max", "alias": "<name>" }] }`
- `cast` — cast a column to a new type; config: `{ "column": "<col>", "toType": "string|integer|float|boolean|timestamp" }`

#### Scenario: rename step renames columns
- **WHEN** a pipeline step has `op: "rename"` with config `{ "mappings": { "old_col": "new_col" } }`
- **THEN** the resulting DataFrame has a column named `new_col` and no column named `old_col`

#### Scenario: filter step reduces rows
- **WHEN** a pipeline step has `op: "filter"` with config `{ "expression": "age > 18" }`
- **THEN** the resulting DataFrame contains only rows where `age > 18`

#### Scenario: compute step adds a new column
- **WHEN** a pipeline step has `op: "compute"` with config `{ "column": "full_name", "expression": "concat(first, ' ', last)" }`
- **THEN** the resulting DataFrame contains a column named `full_name` with the concatenated value

#### Scenario: groupby step aggregates rows
- **WHEN** a pipeline step has `op: "groupby"` with `groupByColumns: ["dept"]` and aggregation `{ "column": "salary", "function": "sum", "alias": "total_salary" }`
- **THEN** the resulting DataFrame has one row per unique `dept` value with a `total_salary` column

#### Scenario: cast step changes column type
- **WHEN** a pipeline step has `op: "cast"` with config `{ "column": "age", "toType": "string" }`
- **THEN** the resulting DataFrame column `age` has type `StringType`

#### Scenario: join step combines two DataFrames
- **WHEN** a pipeline step has `op: "join"` specifying a `joinKey` and `dataTypeId`
- **THEN** the resulting DataFrame contains columns from both the source and target DataFrames joined on the key column

#### Scenario: Unknown op returns a failed run
- **WHEN** a pipeline step has an unrecognized `op` value
- **THEN** the run transitions to `status: "failed"` with an error message identifying the unknown op

### Requirement: PipelineRunCache is a thread-safe in-memory store
The `PipelineRunCache` SHALL store run entries keyed by `runId` (UUID string) with the following
fields: `status` (one of `queued`, `running`, `succeeded`, `failed`), `rows`
(`Option[Seq[Map[String, Any]]]`), and `error` (`Option[String]`). Reads and writes from multiple
concurrent threads SHALL be safe without external synchronization by callers.

#### Scenario: Initial entry has queued status and no rows
- **WHEN** a new runId is stored immediately after submission
- **THEN** `PipelineRunCache.get(runId)` returns an entry with `status: "queued"`, `rows: None`, `error: None`

#### Scenario: Entry is updated to succeeded with rows
- **WHEN** the Spark job completes and updates the cache
- **THEN** `PipelineRunCache.get(runId)` returns an entry with `status: "succeeded"` and `rows` containing the result data

#### Scenario: Entry is updated to failed with error
- **WHEN** the Spark job throws an exception
- **THEN** `PipelineRunCache.get(runId)` returns an entry with `status: "failed"` and a non-empty `error` string

#### Scenario: Missing runId returns None
- **WHEN** `PipelineRunCache.get(runId)` is called for a runId that was never inserted
- **THEN** the result is `None`

### Requirement: Spark dependencies do not conflict with Pekko
The `build.sbt` SHALL add `spark-core` and `spark-sql` 3.5.x in `compile` scope with exclusions
that prevent Akka and Pekko transitive dep conflicts. `sbt evicted` SHALL report no critical
evictions for `pekko-*` or `akka-*` artifacts.

#### Scenario: Backend starts without ClassNotFoundException for Pekko classes
- **WHEN** `sbt run` is executed with Spark dependencies present
- **THEN** the server starts successfully and Pekko HTTP routes respond normally, with no `ClassNotFoundException` or `NoSuchMethodError` for Pekko/Akka classes in the logs

#### Scenario: sbt test suite passes with Spark on classpath
- **WHEN** `sbt test` is executed with Spark dependencies present
- **THEN** all existing tests pass and no new test failures are introduced by the Spark JARs
