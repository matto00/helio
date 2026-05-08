# HEL-202 — Pipeline execution engine: submit jobs to Spark

## Description

Replace the in-process pipeline execution engine with Spark job submission. Pipeline definition is serialized into a Spark job. Results are written back to the DataType snapshot store on job completion.

## User Decisions (from planning session)

1. **Job submission approach**: Use `spark-core` (and `spark-sql`) client library directly in the Scala/Pekko backend. Add as a dependency to `build.sbt`. Accept size/compatibility tradeoffs.

2. **Result storage**: In-memory cache only. A follow-up ticket (HEL-232) will handle Iceberg table persistence. The execution result (rows + schema) should be held in a simple in-memory map keyed by runId, accessible to the status/result endpoints.

3. **Build approach**: Go straight to Spark — skip any in-process engine step. HEL-186 is superseded by this ticket.

4. **Prerequisite**: HEL-201 (cluster setup) is merged to main. The Spark cluster runs locally via `docker-compose.spark.yml` using `apache/spark:3.5.0`. Backend config already has `spark.masterUrl` in `application.conf`.

## What to Deliver

### 1. `build.sbt` — Spark dependencies
- Add `spark-core` and `spark-sql` for Scala 2.13 / Spark 3.5.x
- Scope carefully to avoid Akka/Pekko conflicts:
  - Exclude `akka-*` transitive deps from Spark JARs
  - Use `"provided"` scope only if the cluster supplies the JARs; otherwise use `"compile"` with exclusions
  - Exclude `slf4j` / `log4j` conflicts as needed

### 2. `SparkJobSubmitter` service
- Location: `backend/src/main/scala/helio/spark/SparkJobSubmitter.scala`
- Takes a pipeline definition (PipelineId, ordered list of PipelineStep) and builds a Spark DataFrame job
- Submits to the Spark cluster using `SparkSession` (master URL from config)
- Returns a `RunId` (UUID string) immediately; job runs asynchronously
- Supported step operations (from HEL-228 schema):
  - `rename` — rename one or more columns
  - `filter` — apply a filter expression to rows
  - `join` — join two DataFrames on a key column
  - `compute` — add a computed column from an expression
  - `groupby` — group by columns and apply aggregation
  - `cast` — cast a column to a new data type

### 3. `PipelineRunCache` (in-memory)
- Location: `backend/src/main/scala/helio/spark/PipelineRunCache.scala`
- A thread-safe in-memory store keyed by `RunId`
- Stores:
  - `status`: `queued | running | succeeded | failed`
  - `rows`: `Option[Seq[Map[String, Any]]]` — populated on success
  - `error`: `Option[String]` — populated on failure
- Accessible to HTTP route handlers

### 4. HTTP Endpoints

#### `POST /api/pipelines/:id/run`
- Validates the pipeline exists
- Calls `SparkJobSubmitter.submit(pipeline)`
- Stores initial status `queued` in `PipelineRunCache`
- Returns `201` with body: `{ "runId": "<uuid>" }`

#### `GET /api/pipelines/:id/runs/:runId`
- Looks up runId in `PipelineRunCache`
- Returns `200` with body:
  ```json
  {
    "runId": "<uuid>",
    "status": "queued|running|succeeded|failed",
    "rows": [...],   // present if succeeded
    "error": "..."   // present if failed
  }
  ```
- Returns `404` if runId not found

### 5. Route wiring
- Register the two new endpoints in `ApiRoutes.scala`
- Add JSON serialization for run status/result in `JsonProtocols.scala`

## Acceptance Criteria

- `POST /api/pipelines/:id/run` returns a `runId` and the job starts on the Spark cluster
- `GET /api/pipelines/:id/runs/:runId` returns current status; when succeeded, includes result rows
- All six step operations (rename, filter, join, compute, groupby, cast) are translated to DataFrame API calls
- `sbt test` passes with unit tests for `SparkJobSubmitter` (mocked SparkSession or local mode) and `PipelineRunCache`
- `npm test` passes
- No Akka/Pekko conflicts from Spark transitive deps (`sbt evicted` shows no critical evictions)
