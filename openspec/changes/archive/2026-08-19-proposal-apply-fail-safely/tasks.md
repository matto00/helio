## 1. Backend

- [x] 1.1 Add `kind: String` and `fetchError: Option[String] = None` to `PipelineProposalService.ResolvedSource`;
      populate `kind` at every resolution site (`ds.kind` for existing-sourceId; `DataSourceKind.RestApi`/
      `.Sql`/`.Static` for each inline branch).
- [x] 1.2 Add `SparkUnsupportedKinds: Set[String] = Set(DataSourceKind.RestApi, DataSourceKind.Sql)` to
      `PipelineRunService`'s companion object (single source of truth for the kind list `runPipeline`/
      `previewStep` already hardcode as sealed-trait matches — those two match arms stay unchanged).
- [x] 1.3 Change `handleInlineCreated` (`rest_api`/`sql` shared post-create handling) to take a `kind`
      parameter from its two callers and, on `csr.fetchError = Some(err)`, return `Right(ResolvedSource(...,
      fetchError = Some(err)))` instead of deleting the source and returning `Left(BadGateway)`.
- [x] 1.4 Add `PipelineRunService.recordUnrunnable(pipelineId, reason, user): Future[RunResultResponse]`,
      mirroring `onBlockedRun`'s persistence pattern (`insertRun` best-effort, `updateRunTerminal(runId,
      "failed", now, rowCount = None, errorLog = Some(reason), user)`, `pipelineRepo.updateLastRun(pipelineId,
      "failed", now, rowCount = None, user)`), returning a `blocked = true` `RunResultResponse` carrying
      `blockedReason = Some(reason)` and the new `runId`.
- [x] 1.5 In `createPipeline`, after `addSteps` succeeds, branch on
      `PipelineRunService.SparkUnsupportedKinds.contains(resolved.kind)`: when true, skip
      `pipelineRunService.submit`, call `pipelineRunService.recordUnrunnable(...)` (task 1.4) for the
      `blockedReason` derived from `resolved.fetchError` when present, else a fixed "not executed
      automatically yet" message, and return `Right(PipelineProposalApplyResponse(...))` with that run; when
      false, existing logic unchanged.
- [x] 1.6 Read through `CombinedProposalService`/`CombinedProposalRoutes` to confirm no change is needed
      there (composes `PipelineProposalService.apply` unmodified) — no code change expected, verification only.

## 2. Tests

- [x] 2.1 Rewrite `PipelineApplyProposalRollbackSpec`'s `"roll back the pipeline, its output type, and an
      inline rest_api source when the run fails"` to assert `201 Created`, retained resource counts,
      `run.blocked = true` with a "not executed automatically yet" `blockedReason`, AND that a
      `pipeline_runs` row now exists for the pipeline with `status = "failed"`/matching `errorLog` (query
      via the same privileged DB helpers the spec base already uses for `allCounts()`).
- [x] 2.2 Rewrite `PipelineApplyProposalRollbackSpec`'s `"roll back the just-created source on an inline
      rest_api schema-fetch failure"` to assert `201 Created`, retained resource counts, `run.blocked =
      true` with a `blockedReason` carrying `"connector: endpoint unreachable"`, and the same persisted
      `pipeline_runs` row check as 2.1.
- [x] 2.3 Add a new test mirroring 2.1/2.2 for an inline `sql` source (shared `handleInlineCreated` path),
      confirming the same fix applies to both connector kinds.
- [x] 2.4 Add a new test for an existing-`sourceId` reference to a pre-existing `rest_api` (or `sql`) source,
      confirming the run is reported `blocked` without rollback on that path too.
- [x] 2.5 Add/keep a regression test confirming `static`/`csv`-sourced proposals are unaffected: the eager
      run still executes and rollback-on-run-failure still applies unchanged.
- [x] 2.6 Add a `PipelineRunService`-level (or repository-level) test for `recordUnrunnable` confirming it
      updates `pipeline.lastRunStatus` to `"failed"` — the field `PipelineListTable.tsx`'s `StatusBadge`
      and `PipelineDetailFooter.tsx` already render, proving "visibly needs-attention" without any
      frontend change.
- [x] 2.7 Run `sbt test` for the full backend suite; confirm no other spec relied on the old rollback
      behavior for `rest_api`/`sql` sources.
