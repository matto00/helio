## Why

Pipelines currently have no execution engine. Steps are defined and persisted (HEL-228) but
running a pipeline does nothing. HEL-202 wires the Spark cluster (provisioned by HEL-201) into
the backend so pipelines can actually execute against real data and return results.

## What Changes

- Add `spark-core` and `spark-sql` 3.5.x dependencies to `build.sbt` with Akka/Pekko conflict
  exclusions
- Introduce a `SparkJobSubmitter` service that translates an ordered list of `PipelineStep`
  records into a Spark DataFrame job and submits it to the configured Spark master
- Introduce a `PipelineRunCache` that holds job status (`queued | running | succeeded | failed`)
  and result rows in memory, keyed by runId (UUID)
- Add `POST /api/pipelines/:id/run` — triggers job submission, returns runId
- Add `GET /api/pipelines/:id/runs/:runId` — returns status and result rows when complete
- Wire both endpoints into `ApiRoutes.scala` with JSON serialization in `JsonProtocols.scala`
- Supported step ops: `rename`, `filter`, `join`, `compute`, `groupby`, `cast`

## Capabilities

### New Capabilities

- `pipeline-run-api`: HTTP endpoints for triggering a pipeline run and polling its status/result
- `spark-job-submitter`: Backend service that maps pipeline steps to Spark DataFrame operations
  and submits jobs to the Spark cluster

### Modified Capabilities

- `pipeline-create-api`: `lastRunStatus` and `lastRunAt` fields on pipeline summary — these fields
  already exist in the response schema but are always null; no spec-level requirement changes needed

## Impact

- `backend/build.sbt` — new Spark dependencies
- `backend/src/main/scala/helio/spark/` — new package with `SparkJobSubmitter` and `PipelineRunCache`
- `backend/src/main/scala/helio/ApiRoutes.scala` — two new route registrations
- `backend/src/main/scala/helio/JsonProtocols.scala` — run status/result JSON formats
- `backend/src/test/scala/helio/spark/` — unit tests for submitter and cache
- No frontend changes in this ticket; result polling UI is a follow-up

## Non-goals

- Persisting results to Iceberg tables (follow-up: HEL-232)
- Frontend UI for triggering runs or displaying results
- Authentication/ACL enforcement on the new endpoints (follow-up)
- Streaming or incremental results
- Cancelling in-flight jobs
