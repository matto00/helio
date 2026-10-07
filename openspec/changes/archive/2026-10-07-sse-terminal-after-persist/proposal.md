## Why

A pipeline run's terminal SSE event (`succeeded`/`failed`/`dry_run`) is published before the run's terminal status and
its Output snapshots are committed. A subscriber that reacts quickly reads stale state and marks the run observed. Its
later reconcile against `runs/latest` dedups that run id, so a bound panel can miss a refresh permanently. That is the
cause of the hel1094 e2e flake (second refresh missed 120s on CI, see ticket.md). It is also a real product defect:
under load, a live dashboard silently shows pre-run data.

## What Changes

- The backend publishes each run's terminal event only after that run's durable terminal writes have completed: the
  `pipeline_runs` terminal status, and for a succeeded run also the materialized `node_snapshots` and the pipeline's
  last-run metadata. This applies to every terminal path. Exactly one terminal event per run is still published, even
  when a terminal write fails.
- New failing-first backend coverage for the ordering on every terminal path.
- e2e: three local `registerThenLogin` copies and eleven local `uniqueEmail` copies are moved onto
  `e2e/support/auth.ts`, behaviour-preserving.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-sse`: the terminal-event requirement gains an ordering guarantee. A terminal event is published only
  after the run's terminal state is durably readable.

## Impact

- `backend/.../services/pipelines/PipelineRunService.scala` (terminal-path publish ordering) plus a backend spec.
- `e2e/support/auth.ts` and 14 e2e specs (helper consolidation only).
- No API shape, schema or migration change. Terminal event latency rises by the duration of the terminal writes.

## Non-goals

- Lengthening hel1094's 120s waits, or changing the client fan-out/reconcile logic (`pipelineRunFanout.ts`). With the
  server ordering fixed, the client's existing dedup is correct.
- Persisting the intermediate `running` status, and event replay.
