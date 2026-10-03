## Context

See proposal.md. `PipelineRunCache` is a per-instance `TrieMap[runId, RunEntry]`; `RunEntry(runId, status, rows, error)` carries no pipeline or owner. `PipelineRunService.status(runId)` projects it. The cache is populated only by `SparkJobSubmitter.submit` (no caller today). The HEL-1002 pattern for a pipeline-scoped read is `PipelineRunService.latestRun`: `pipelineRepo.findByIdShared(pipelineId, Some(user))` -> `None` => `ServiceError.NotFound`, mapped by `ServiceResponse.run` to a uniform 404.

## Goals / Non-Goals

**Goals:**
- A stranger with a valid foreign run id gets the same 404 as for an absent one.
- A run is only returned through the pipeline it belongs to.
- Grantees who can see the pipeline can still read its runs.

**Non-Goals:**
- Wiring the cache / HEL-202, or deleting the dormant route (an owner call; filed as a follow-up if confirmed worth raising).
- Persisting run rows durably or making the cache cross-instance.
- The `POST /api/patch-sets/preview` 500 probe (probed separately; follow-up only if it reproduces with a valid payload).

## Decisions

1. **Record `pipelineId` in the cache entry** (`RunEntry.pipelineId`, `PipelineRunCache.put(runId, pipelineId, status)`, `update` preserves it). Alternative: durable lookup in `pipeline_runs` by run id then join -- rejected: the rows live only in the cache, the durable row has no rows payload, and a second source of truth could disagree with the cache. Binding at write time is what the producer (`SparkJobSubmitter`, which has `pipeline.id`) already knows.
2. **New service method `PipelineRunService.runStatus(pipelineId, runId, user): Future[Either[ServiceError, CachedRunStatus]]`.** Order: visibility lookup (`findByIdShared`) first, then cache lookup, then `entry.pipelineId == pipelineId`. Every failure arm is the same `ServiceError.NotFound` with the **same message** that does not interpolate the run id or distinguish the reason, so the serialized 404 body is byte-identical across foreign / absent-pipeline / absent-run / wrong-pipeline. The old `status(runId)` user-free method is removed so no user-free lookup remains (audit: its only caller was this route).
3. **Mismatched pipeline reads the same as absent**, not 403/409, per HEL-1002.
4. Test seam: `ExistenceNotLeakedRoutesSpec.buildApi` must expose the `PipelineRunCache` it constructs so a row can seed a run owned by the seeded pipeline. The row's "foreign" arm is a stranger requesting the owner's pipeline with the real seeded run id; "nonexistent" is a random id; both must equal. Extra tests (service/route spec): run seeded under pipeline A requested via the stranger's own pipeline B -> same 404; viewer grantee of A -> 200; owner -> 200.
5. Audit of other user-free run lookups (SSE `run-events` / `PipelineRunRegistry`, `runs/latest`, history, MCP): confirmed during execution by reading the code and recorded in the evaluator-visible tasks; any that lacks `findByIdShared` is fixed or filed.

## Risks / Trade-offs

- [Cache entries written before this change lack a pipeline id] -> cache is in-memory only and nothing populates it today; no migration.
- [`RunEntry` signature change breaks test fixtures] -> update fixtures in the same change; compile is the gate.
- [Grantee viewing rows may be a broader disclosure than intended] -> same visibility `latestRun`/`history` already grant (`findByIdShared`); no new tier.
