## Why

`PipelineRunRegistry` stores one `ActorRef` per pipeline; a second concurrent subscriber silently
overwrites the first, and each backend instance's registry is independent, so an event published on
the instance that ran a pipeline never reaches a subscriber whose SSE connection landed on the other
Cloud Run instance (`--max-instances=2`, no session affinity). This makes HEL-1094's auto-refresh AC
fail intermittently in prod and is now a High-priority blocker on the v0.8.4 cut (owner ruling,
2026-09-23).

## What Changes

- Replace `PipelineRunRegistry`'s single-`ActorRef`-per-pipeline map with a genuine multi-subscriber
  broadcast: every live subscriber for a pipeline receives every published event, not just the most
  recently registered one.
- Add cross-instance delivery so an event published by the backend instance that executed a run
  reaches subscribers whose SSE connection is held open on a *different* instance, sharing only the
  Postgres database. Candidate mechanism: Postgres `LISTEN/NOTIFY`, using a small dedicated
  connection budget separate from the existing app/privileged HikariCP pools — the specific
  mechanism and its connection-budget trade-off is confirmed via escalation before implementation
  (see design.md).
- Preserve `pipelineExistsShared` ACL scoping — no mechanism introduced here may become a
  cross-tenant side channel.
- No frontend change: `pipelineRunFanout.ts` / `usePipelineRunEvents.ts` keep working unmodified.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-run-sse`: `PipelineRunRegistry` now fans out to every live subscriber for a pipeline
  (not just the latest), and delivery is no longer scoped to a single backend instance — an event
  published on any instance reaches every subscriber on every instance, still ACL-scoped per
  pipeline.

## Impact

- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala` (core rewrite).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` (publish call
  sites — unchanged signature, unchanged callers).
- New: a Postgres `LISTEN`/`NOTIFY`-backed cross-instance bus (or the escalated alternative),
  including its own small connection allocation and a new Flyway migration if a channel/table is
  needed (next free id: V111).
- `docs`/`CLAUDE.md` prod env-var table if any new env var is introduced; `cd-backend.yml` if any
  new flag/secret is needed.
- No API contract change: `GET /api/pipelines/:id/run-events` keeps its existing wire format.

## Non-goals

- No change to the SSE wire format or the `RunStatusEvent` JSON shape.
- No change to `pipelineRunFanout.ts`/`usePipelineRunEvents.ts` (frontend already correct per
  HEL-1094).
- No general-purpose pub/sub abstraction beyond what pipeline run-status events need.
