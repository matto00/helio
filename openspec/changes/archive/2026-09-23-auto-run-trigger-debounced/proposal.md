## Why

A dataset write from an interactive panel (e.g. a counter control) currently never refreshes the
downstream pipelines that read it — the user has to manually re-run each one. HEL-1091's
write-back epic needs the write to trigger those runs automatically, but naively firing one run
per write breaks under rapid input (ten clicks in two seconds must produce one run, not ten) and
must not bypass HEL-505's per-user rate/concurrency guards or HEL-1092's cheapness verdict.

## What Changes

- A dataset write (`DataSourceService.appendFormRow`) schedules a debounced auto-run of each
  downstream pipeline whose root reads that dataset AND whose `PipelineCostEstimator` verdict is
  `autoRunnable`.
- The debounce/coalescing window fires at most one run per pipeline per burst, and holds correctly
  under helio's multi-instance (up to 2 Cloud Run instances) deployment — not a per-instance-only
  in-memory timer.
- The triggered run enters through the existing `PipelineRunService.submit` choke point (a new
  `TriggerSource` value), so it is subject to HEL-505's rate-limit/concurrency-cap guards
  identically to manual/hook/scheduled runs, and is attributed to the pipeline owner as the
  principal (mirroring HEL-1108's scheduled-run precedent).
- A denied (cheapness verdict) or rejected (rate/concurrency-limited) auto-run is recorded/logged,
  never silently dropped.
- New repository lookup: pipelines whose root(s) reference a given `DataSourceId`.

## Capabilities

### New Capabilities
- `dataset-write-auto-run`: a dataset write debounces and triggers an auto-run of each eligible
  (cheap-verdict-passing) downstream pipeline, entering through `PipelineRunService.submit` as the
  pipeline owner, correct under a multi-instance deployment.

### Modified Capabilities
(none — `pipeline-run-guard`'s existing requirements already cover "any future automated trigger"
and need no delta; this change adds a new trigger path that is subject to those requirements, it
does not change them)

## Impact

- Backend: `DataSourceService`/`PipelineRunService`/a new debounce-scheduling component; a new
  `TriggerSource` value; a new `PipelineRepository`/`PipelineRootRepository` lookup by
  `DataSourceId`.
- DB: likely a new migration (next free version `V110`) for DB-backed debounce state if an
  in-memory-per-instance timer cannot satisfy the AC under 2 concurrent Cloud Run instances (see
  design.md).
- No REST contract change — the trigger is internal, fired from the existing
  `POST /api/panels/:id/submit` write path.

## Non-goals

- Cascading auto-runs: `PipelineCostEstimator.WriteBackOps` already denies any pipeline containing
  `upsertsource`, so a write-back-producing downstream pipeline can never itself pass the
  cheapness verdict and auto-run further — no additional cascade-prevention needed.
- The "Run to update" manual affordance for a denied pipeline (HEL-1096).
