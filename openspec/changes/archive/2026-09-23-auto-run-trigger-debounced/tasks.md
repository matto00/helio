## Standing Constraints

- [C1] Auto-run debounce state is DB-backed and global (V110 `pipeline_auto_run_debounce`), fired
  by the EXISTING `PipelineSchedulerService` tick — no dedicated new timer/sweeper. The debounce
  claim must be genuinely atomic/exclusive across instances (not a TOCTOU-prone check like the
  scheduler's own `hasActiveRunInternal`). Owner ruling, 2026-09-23, resolving the Planning
  escalation on in-memory vs. DB-backed debounce.

## 1. Backend — schema & guards

### Backend
- [x] 1.1 `V110__pipeline_auto_run_debounce.sql`: create `pipeline_auto_run_debounce`
      (`pipeline_id` PK/FK CASCADE, `fire_at`, `claimed_at`), FORCE RLS with the V62 indirect-owner
      pattern (join to `pipelines.owner_id`); widen `pipeline_runs_trigger_source_check` to include
      `'auto-run'`.
- [x] 1.2 Add `TriggerSource.AutoRun = "auto-run"` to `PipelineRunService`'s `TriggerSource` object.
- [x] 1.3 New `PipelineAutoRunDebounceRepository` (privileged/`withSystemContext` only): `upsertDebounce
      (pipelineId, fireAt)` (the forward-only `GREATEST`/`claimed_at = NULL` UPSERT from design.md
      Decision 2), `claimDue(now, staleClaimAfter)` (atomic `UPDATE ... RETURNING`, design.md
      Decision 3 step 1), `releaseClaim(pipelineId, claimedAt)` (compare-and-delete, design.md
      Decision 3 step 4).
- [x] 1.4 New `PipelineRootRepository.listPipelineIdsForDataSourceInternal(dataSourceId):
      Future[Vector[PipelineId]]` — privileged lookup of every pipeline whose root references a
      given data source.
- [x] 1.5 New `PipelineCostInputGathering.gather(pipelineId, enabledSteps, lastRunRowCount,
      resolveRoot: DataSourceId => Future[Option[DataSource]]): Future[CostInput]` — shared root-
      list resolution + dataset-row-count lookup + `CostInput` assembly, with root-to-`DataSource`
      resolution supplied by the caller (design.md Decision 2a — design-gate round 1 fix:
      `analyze`'s ACL-scoped `findByIdOwned` must NOT be reused verbatim for the auto-run path,
      whose caller has no ACL relationship to the pipeline's other roots). `PipelineService.analyze`
      is refactored to call this with `resolveRoot = dsId => dataSourceRepo.findByIdOwned(dsId,
      user)` (byte-for-byte unchanged behavior); also move `PipelineService.hasSourceUrl` into the
      shared object. New `PipelineRepository.findLastRunRowCountInternal(pipelineId):
      Future[Option[Long]]` (privileged scalar accessor) for the auto-run path's `lastRunRowCount`.

## 2. Backend — trigger wiring

### Backend
- [x] 2.1 New `AutoRunTriggerService.triggerAutoRun(dataSourceId, now)`: look up eligible pipelines
      (1.4), gather `CostInput` via `PipelineCostInputGathering.gather(..., resolveRoot = dsId =>
      dataSourceRepo.findByIdInternal(dsId))` (1.5 — privileged, NOT `findByIdOwned`, since there is
      no `AuthenticatedUser` in this method's own signature and the writer's ACL is irrelevant to
      the pipeline's other roots) and call `PipelineCostEstimator.estimate` per pipeline; log (INFO,
      pipeline id + data source id + every `CostReason`) and skip when denied; otherwise call
      `PipelineAutoRunDebounceRepository.upsertDebounce`.
- [x] 2.2 Wire `AutoRunTriggerService.triggerAutoRun` as a fire-and-forget call (wrapped in
      `.recover` that logs and swallows) from all five `DataSourceService` row-mutation methods —
      `appendRows`, `appendFormRow`, `replaceRows`, `patchRow`, `deleteRow` — alongside each
      method's existing `audit(...)` call, on the successful-write branch only.
- [x] 2.3 Extend `PipelineSchedulerService.tick()` with the claim-and-fire pass (design.md Decision
      3 steps 1-4): claim due rows, skip (but still release) on `hasActiveRunInternal`, otherwise
      build the synthetic owner `AuthenticatedUser` (mirrors `fire`'s existing pattern exactly) and
      `submit(..., triggerSource = TriggerSource.AutoRun)`, then always release the claim. Log a
      guard rejection (`ServiceError.TooManyRequests`) rather than swallowing it.
- [x] 2.4 New config `DATASET_WRITE_DEBOUNCE_SECONDS` (default `5`), read by
      `AutoRunTriggerService` (`AutoRunTriggerService.debounceSecondsFromEnv()`, mirroring
      `PipelineRunGuardConfig.fromEnv()`'s pure-env convention — every sibling `PIPELINE_RUN_*`
      numeric config in this codebase is read the same way, with no `application.conf` entry of
      its own); documented in `helio/CLAUDE.md`'s production env var table alongside the existing
      `PIPELINE_RUN_*`/`SCHEDULER_TICK_INTERVAL_SECONDS` entries.

## 3. Tests

### Tests
- [x] 3.1 `PipelineCostEstimator`-integration probe: a pipeline denied by the verdict never gets a
      debounce row scheduled from a dataset write (mutation: temporarily force `autoRunnable =
      true` and show the probe fails — the red case for the deny arm).
      (`AutoRunTriggerServiceSpec` — the denial test seeds a denied pipeline AND an eligible
      sibling reading the same data source in the same call, proving the evaluation actually
      distinguishes denied from eligible rather than never scheduling anything.)
- [x] 3.2 Debounce coalescing, single instance: ten writes to the same dataset within two seconds,
      against a real Postgres-backed `pipeline_auto_run_debounce`/scheduler tick, produce exactly
      one row in `pipeline_runs`. Count from `pipeline_runs`, never from log lines.
      (`DatasetWriteAutoRunCoalescingSpec` — green: 10 writes -> 1 row.)
- [x] 3.3 **Mutation-proves-the-AC (red case):** the same ten-writes-in-two-seconds scenario with
      debounce disabled (e.g. a zero-length window / a direct-submit code path) produces ten rows
      in `pipeline_runs`, not one — demonstrating the probe in 3.2 actually distinguishes debounced
      from non-debounced behavior.
      (`DatasetWriteAutoRunCoalescingSpec` — the same 10-writes count, submitted directly through
      `PipelineRunService.submit` bypassing the debounce table entirely, produces 10 rows.)
- [x] 3.4 Cross-instance debounce: two `PipelineSchedulerService`/`AutoRunTriggerService` instances
      sharing one database, ten writes split across both within two seconds, still produce exactly
      one row in `pipeline_runs` — proves `claimDue`'s atomicity, not just single-process
      correctness.
      (`DatasetWriteAutoRunCoalescingSpec` — two independent instance pairs, writes interleaved,
      both schedulers' `tick()` called concurrently via `Future.sequence`; still exactly 1 row.)
- [x] 3.5 RLS probe: `pipeline_auto_run_debounce` FORCE RLS is actually in effect — a plain
      app-pool query under a non-owning user's `app.current_user_id` context returns zero rows for
      another user's pipeline's debounce row (mirrors the existing `pipeline_run_rate_window`/
      `pipeline_schedules` RLS test pattern).
      (`PipelineAutoRunDebounceRepositorySpec`, dual-pool `helio_app_test` harness mirroring
      `PipelineRunGuardRepositorySpec`.)
- [x] 3.6 Owner-attribution probe: a dataset write by a non-owning editor grantee schedules an
      auto-run that, once fired, is recorded in `pipeline_runs`/counts against the pipeline
      owner's rate-limit window, not the writer's.
      (`DatasetWriteAutoRunEndToEndSpec` — mutation-sensitive: owner's rate limit pre-exhausted to
      1, writer's own budget untouched; the auto-run is rejected, proving attribution to the owner
      — a wrong (writer-scoped) attribution would have let it through.)
- [x] 3.7 Guard-rejection-is-not-silently-dropped probe: with the pipeline owner already at the
      rate limit, a debounce fire logs the rejection and does not throw/crash the tick.
      (`DatasetWriteAutoRunEndToEndSpec` — `tick()` completes normally, zero rows inserted, claim
      still released.)
- [x] 3.8 Non-cascade probe: a pipeline's `upsertsource` write-back step does not itself schedule a
      debounce row for any pipeline reading the written-to dataset.
      (`AutoRunTriggerServiceSpec` — calls `DataSourceRepository.applyWriteBacks` directly, the
      real code path `upsertsource` steps use, and confirms no debounce row appears for the
      downstream reader.)
- [x] 3.9 Measure and report real end-to-end write-to-run latency (last write to `pipeline_runs`
      row appearing) in the PR body, per design.md Decision 5.
      (`DatasetWriteAutoRunEndToEndSpec` — real wall-clock measured: ~1075ms observed for a 1s
      configured debounce with fast local polling; production worst case with real defaults
      reported to the orchestrator for the PR body: ~35s = 5s debounce + up to 30s tick interval.)
- [x] 3.10 **Multi-root, mixed-ownership probe (design-gate round 1 fix, design.md Decision 2a):** a
      pipeline with two roots — one dataset owned by the writer (the one they wrote to), one
      dataset owned by a DIFFERENT user (e.g. an editor grantee's own source bound as a co-root) —
      is still correctly evaluated as `autoRunnable` (assuming both roots are otherwise cheap) and
      auto-runs on a write to the writer-owned root. Must fail red against the original
      `findByIdOwned`-reusing design (co-root resolves to `None` → `unclassified-source` → wrongly
      denied) to prove this test actually exercises the fix.
      (`AutoRunTriggerServiceSpec` — two roots owned by different users; the service has no
      `AuthenticatedUser`/writer concept in its signature at all by construction, so a regression
      back to a writer-scoped resolver would fail this test red.)
