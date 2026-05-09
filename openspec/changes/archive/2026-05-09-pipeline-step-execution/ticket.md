# HEL-229 — Pipeline step execution — transform logic backend

## Title
Pipeline step execution — transform logic backend

## Description
Implement the server-side transformation engine that executes an ordered sequence of pipeline steps against a data source and writes the result to the Type Registry.

**Supported operations (v1):** Rename field, Filter rows, Join (left/inner), Compute column (expression), Group & aggregate (sum/count), Cast type.

**Execution model:**

* Steps are fetched from `pipeline_steps` (ordered by `position`).
* Each step is applied in sequence to an in-memory DataFrame (Apache Spark job or in-process Scala implementation — TBD based on HEL-143 Spark decision).
* Output is written as a new DataType snapshot to the Type Registry (overwrite mode by default).
* `pipelines.last_run_status` and `last_run_at` are updated on completion.

**API:** `POST /api/pipelines/:id/run` — triggers execution, returns job ID or synchronous result for small datasets.

**Dry-run mode:** `POST /api/pipelines/:id/run?dry=true` — returns preview rows without writing to the registry.

Depends on HEL-228 (pipeline steps API) being complete first.

## Acceptance Criteria
- `POST /api/pipelines/:id/run` triggers execution of all pipeline steps in position order
- `POST /api/pipelines/:id/run?dry=true` returns preview rows (up to N rows) without writing to registry
- Supported step types are executed correctly: Rename field, Filter rows, Join (left/inner), Compute column, Group & aggregate (sum/count), Cast type
- `pipelines.last_run_status` is updated to `success` or `failed` after each run
- `pipelines.last_run_at` is updated after each run
- On success, output is written as a new DataType snapshot to the Type Registry (overwrite mode)
- Errors during step execution are captured and returned with a meaningful message
- Backend tests cover each step type and the dry-run path
