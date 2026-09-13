## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- Both ticket ACs (direct cycle, two-pipeline transitive cycle) are addressed, with a message
  naming the cycle path (`PipelineCycleValidator.CycleError.message`).
- Design-gate-CONFIRMed decisions (rounds 1-3) are all faithfully implemented: multigraph model
  (Decision 1), explicit-filter graph queries never relying on RLS/GUC (Decision 2), cycle-path
  message builder with the documented tie-break (Decision 3/6), the lock+graph-read+write
  composed as one DBIO per write path (Decision 4), `removeRoot`/`deleteStep`/`duplicateStep`
  correctly left unchecked (Decision 5), and the post-CONFIRM id-vs-name fix + named
  `AdvisoryLockKey` constant.
- All 14 tasks in tasks.md are marked done and match what was implemented (verified by reading
  the actual diff, not just the task list).
- No scope creep: the only change outside the five core files is
  `PipelineStepConfigCodec.encodeConfig` gaining an `UpsertSourceConfig` case, which is
  documented as existing solely to let repository-seam tests serialize a typed config (task 3.4's
  own testability requirement) — it does not register the step or touch `PipelineStepKind.All`.
- No regressions: `PipelineCreateTransactionalSpec`'s pinned `upsertsource`-rejected case (and its
  3 siblings) is untouched and still passes (see Phase 2).
- CONSTRAINTS in `workflow-state.md`: none flagged as applicable beyond the standard iron laws;
  no violations observed.

### Phase 2: Code Review — PASS
Issues: none blocking.

Verified against the specific regression risks called out in the design-gate history:

1. **One DBIO/transaction per write path** — confirmed by reading the actual code, not just
   comments:
   - `PipelineRepository.create` (simple path): `PipelineCycleGuard.checkExistingGraphAction(...).andThen(DBIO.seq(pipelinesTable += ..., rootsTable ++= ...))`, run as a single action under one `ctx.withUserContext(...)` call (PipelineRepository.scala:363-366).
   - `PipelineRepository.createAction` (transactional path): identical shape, composed into the caller's larger `runTransactionally` chain (PipelineRepository.scala:436-438).
   - `PipelineRootRepository.add`: the lock+check runs inside the same `ctx.withUserContext { for { ... } yield row }` flatMap chain, ahead of the `rootsTable += row` insert (PipelineRootRepository.scala:75-83) — not a separate pre-check `Future`.
   - `PipelineStepRepository.spliceInsertAtInternal`/`attachTailInternal`/`updateInternal`: each calls `cycleCheckForUpsertAction` inside its own `withSystemContext(...).transactionally` DBIO, ahead of the row write (confirmed at lines 407, 560, 663).
   None of these regressed to a separate pre-flight `Future` ahead of the persistence call — the exact bug the design-gate rounds 1/2 found and required fixing.

2. **Explicit `userId` filter, never RLS/GUC** — `PipelineRootRepository.findReadEdgesVisibleTo` and `PipelineStepRepository.findUpsertWriteEdges` both take an explicit `userId: String`, build `visiblePipelineIds` via an inline join mirroring `helio_can_access_pipeline`'s predicate (`owner_id = userId OR userId is a resource_permissions grantee`), and are called identically from both `withUserContext` (`create`/`addRoot`) and `withSystemContext` (`spliceInsertAtInternal`/`attachTailInternal`/`updateInternal`) call sites — confirmed by reading the queries directly (no dependency on `current_setting('app.current_user_id')`). Tests (`PipelineCycleGraphQueriesSpec`) explicitly assert cross-tenant exclusion under `withSystemContext` (BYPASSRLS), which is exactly the round-2 REFUTE's concern.

3. **Three-colour DFS** — `PipelineCycleValidator.findCycle` uses White/Gray/Black coloring; a back edge to Gray closes a cycle, a back edge to Black does not. `PipelineCycleValidatorSpec` has an explicit diamond-false-positive test plus a second test asserting the naive two-colour ("any visited node") mistake would wrongly flag it — this is exactly the guard the ticket called for.

4. **`upsertsource` not registered** — confirmed absent from `PipelineStep.Registry`/`PipelineStepKind.All` (`grep` found zero registration references outside `UpsertSourceConfig`/`PipelineCycleValidator`/comments). `PipelineCreateTransactionalSpec`'s pinned rejection test for `upsertsource` (and 3 siblings) is unmodified in this diff and passed in the full suite run.

5. **Error message names data source by id when caller isn't owner** — `PipelineCycleGuard.resolveDisplayNamesAction` looks up each source's `ownerId` and substitutes the raw id string whenever `ownerId != actingUserId`, only using the name for the owner. `PipelineCycleDetectionServiceSpec`'s editor-grantee test explicitly pins this ("naming a non-owned source by id").

6. **Full backend suite re-run fresh** (not trusting the executor's report): `sbt test` run directly in `WORKTREE_PATH/backend` — `Total number of tests run: 4307`, `succeeded 4307, failed 0, canceled 0`, exit code 0. This includes the new `PipelineCycleValidatorSpec`, `PipelineCycleGraphQueriesSpec`, `PipelineCycleDetectionServiceSpec`, and the updated `PipelineStepRepositorySpliceSpec`.

Other code-quality observations (non-blocking):
- DRY: the lock+graph-read+check composition is correctly centralized in `PipelineCycleGuard` rather than hand-copied at 5 call sites, as the design intended.
- Readable/modular: `PipelineCycleValidator` is a pure, DB-free domain object with clear scaladoc; `PipelineCycleGuard` cleanly separates the four call-site shapes (`checkAction`/`checkExistingGraphAction`/`checkAddReadAction`/`checkAddWriteAction`).
- No dead code / no leftover TODOs found in the new files.
- The `PipelineStepConfigCodec` addition is a narrow, justified, test-seam-only change — not scope creep.
- Concurrency test (`PipelineCycleDetectionServiceSpec`, "serialize two writes...") genuinely fires two `Future`s concurrently via `Future.sequence` and asserts exactly one is rejected and the other's write is durably persisted — this is real evidence of the advisory lock's atomicity, not a sequential-call illusion.

### Phase 3: UI Review — N/A
No files under `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` changed by this diff (backend-only domain/persistence/service change plus its own new spec directory). Confirmed via the diff stat.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None beyond what's already noted above.
