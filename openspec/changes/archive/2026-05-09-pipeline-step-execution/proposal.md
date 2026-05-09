## Why

Pipeline steps can be created and persisted (HEL-228), but there is no engine to execute them.
Without a run endpoint, pipelines are inert — users cannot actually transform data or write results
to the Type Registry.

## What Changes

- Add `POST /api/pipelines/:id/run` that fetches pipeline steps ordered by position, applies each
  step in sequence to an in-memory DataFrame, and writes the result as a new DataType snapshot to
  the Type Registry (overwrite mode).
- Add dry-run support via `?dry=true` query parameter — executes steps but returns preview rows
  instead of persisting to the registry.
- Update `pipelines.last_run_status` (`"succeeded"` or `"failed"`) and `pipelines.last_run_at` on
  each run attempt.
- Implement six step types: Rename field, Filter rows, Join (left/inner), Compute column
  (expression), Group & aggregate (sum/count), Cast type.
- Return a structured error response when any step fails during execution.

## Capabilities

### New Capabilities

- `pipeline-run-execution`: POST /api/pipelines/:id/run endpoint, step execution engine (all six
  op types), dry-run preview, status updates, and Type Registry write-back.

### Modified Capabilities

- `pipeline-list-api`: `last_run_status` and `last_run_at` columns are now written by the execution
  engine on each run (behavior previously unspecified for the write path).

## Impact

- Backend: new `PipelineExecutor` service (or equivalent), new route in `ApiRoutes.scala`, new
  repository method to upsert a DataType snapshot, Scala in-process DataFrame (no Spark dependency
  for v1).
- No frontend changes in this ticket.
- No schema migrations needed (columns already exist from HEL-228 / HEL-201).

## Non-goals

- Spark-based execution (deferred to HEL-143 decision).
- Job queue / async polling for large datasets (synchronous execution only for v1).
- Incremental / append write modes (overwrite only).
- Frontend run-trigger UI.
