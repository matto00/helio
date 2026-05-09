## Context

The pipeline persistence layer (HEL-228) and the Spark job submission path (HEL-202/209) already
exist. `SparkJobSubmitter.applyStep` implements all six step ops via Spark DataFrames. However:

1. The run endpoint has no dry-run (`?dry=true`) support.
2. On success, results are cached in `PipelineRunCache` (in-memory) but the output DataType in the
   Type Registry is never updated — making pipelines effectively read-only from the registry's POV.
3. A Spark-free in-process engine is needed for local development and small datasets (HEL-143 has
   not yet resolved the production Spark question).

## Goals / Non-Goals

**Goals:**
- Add `?dry=true` query parameter to `POST /api/pipelines/:id/run` — executes steps, returns preview
  rows, skips registry write-back and `last_run_status` update.
- Write output schema + data snapshot to the output DataType (`pipelines.output_data_type_id`) on
  successful non-dry runs.
- Implement `InProcessPipelineEngine` — a pure-Scala, Spark-free execution engine that supports all
  six step ops on `Seq[Map[String, Any]]` rows using `ExpressionEvaluator` (already in the domain).

**Non-Goals:**
- Replace the Spark path; both engines coexist. Spark is used when available; in-process is the
  fallback/default for local dev.
- Append or merge write modes (overwrite only).
- Async job queue or progress polling for large-dataset jobs.
- Frontend run trigger UI.

## Decisions

### D1: In-process engine as default; Spark as opt-in override
Introduce `InProcessPipelineEngine` in `com.helio.domain`. `PipelineRunRoutes` will use it by
default. `SparkJobSubmitter` remains wired only when `SPARK_MASTER_URL` is explicitly configured.
This avoids Spark startup overhead in local dev and CI, and unblocks HEL-229 independent of
HEL-143's outcome.

Alternative considered: always use Spark — rejected because Spark startup adds 5–10 s overhead per
test run and is unavailable in CI without a running cluster.

### D2: Dry-run as a query parameter on the existing POST endpoint
`POST /api/pipelines/:id/run?dry=true` re-uses the same route and execution engine but skips
registry write-back and status column updates. Returns `200 OK` with inline rows (not `201 Created`
with a run ID).

Alternative: separate `POST /api/pipelines/:id/preview` endpoint — rejected because it duplicates
routing logic with no clear benefit.

### D3: Type Registry write-back via DataTypeRepository.update
After a successful non-dry run, derive the output schema from the result rows' keys (string columns)
and call `DataTypeRepository.update` on the pipeline's `output_data_type_id`. This is "overwrite"
mode — the DataType's `fields` are replaced with the inferred schema from the result.

### D4: Response shape
- `POST /api/pipelines/:id/run` (non-dry): unchanged — returns `201 Created` + `RunSubmitResponse`
  (async Spark path) or immediate `200 OK` + inline rows (in-process path, synchronous).
- `POST /api/pipelines/:id/run?dry=true`: `200 OK` + `{ rows: [...], rowCount: N }`.

Since the in-process engine is synchronous, the non-dry path also returns inline rows immediately
for the in-process case, allowing the client to poll the run-history endpoint for status.

## Risks / Trade-offs

- [Schema inference from result rows is fragile for mixed-type columns] → Mitigation: default all
  inferred field types to "string"; real type inference is HEL-143+ scope.
- [In-process join requires loading the right-hand DataSource into memory] → Mitigation: acceptable
  for v1; join is limited to static/csv sources (same constraint as Spark path).

## Planner Notes

- Self-approved: in-process engine is a new file in `com.helio.domain`, no architectural change.
- Self-approved: dry-run flag and registry write-back are additive changes to `PipelineRunRoutes`;
  no breaking API changes.
- `ExpressionEvaluator` already exists in `com.helio.domain` and is used by `PanelQueryExecutor`;
  the compute and filter steps will delegate to it.
