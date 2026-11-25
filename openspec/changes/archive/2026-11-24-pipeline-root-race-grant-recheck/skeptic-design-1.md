## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: worktree HEAD 737adb3525afa48d2f75576f948221910b732f8d (= main 737adb352), change dir untracked.
Read-only review: no servers, no sbt.

### What I verified (with evidence)

- **Owner rulings match the log.** `.concertino/runs/HEL-1707/events.jsonl` line 6: `escalation.answered`
  `["A-ticket-three-only","fix-in-this-pr","plain-read-after-lock"]` (answer_source human). Line 9: R2 answered
  `R2-creator-and-current-owner-or-editor` (answer_source human). Design Context Q1=A, Q2=R2, Q3=plain read are recorded
  correctly. I did not relitigate them.
- **Item 1 facts.** `PipelineRootRepository.scala:90` reads the name with `.result.head`. `:101` discards the Boolean of
  `locks.lockPipelines(LockSite.RootAdd, ...)`. `PipelineRootWrites.attachRoot` (`:113-118`) recovers only
  `PipelineCycleRejected`, so a NoSuchElementException becomes a 500. `PipelineDefinitionLocks.lockPipelines`
  (`:82-86`) returns `count == ids.size`. Both failure points are real, and D4 handles both.
- **Service pre-checks and their bodies.** `findByIdShared` (`PipelineRepository.scala:83-107`): visible means owner or
  any `resource_permissions` row for the pipeline. `requireEditorAccess` returns `Forbidden("Forbidden")` for a
  non-editor. Draft save `editable` returns `Forbidden()` and `NotFound("Pipeline not found: …")`. No-grant 404 bodies
  by route:
  - root add/remove: `Pipeline not found`
  - step create: `checkAdd` → `pipelineAccessF`, `PipelineStepWriteChecks.scala:94`, `Pipeline not found`
  - reorder: `PipelineStepWrites.scala:100`, `Pipeline not found`
  - update, delete, duplicate: `Pipeline step not found`
- **Placement after lock (3).**
  - Draft save: `DraftSaveTransaction.run:84-86` (`lockDefinition` then `abortIf(!locked)`). Placing the check after
    `:86` is correct in both `sourcesFirst` orders. `DraftRestore.scala:47` goes through `saveCore`, so the undo
    restore is covered.
  - Root remove: `removeRootCascadeAction` (`PipelineStepRepository.scala:1277-1288`) takes panels then lock (3) as its
    first actions. A check placed there runs before any delete. The `afterCascade` hook comes after the check, so race
    tests must not revoke there.
  - Step delete: `deleteAttemptAction` (`:1052-1072`) runs panels, then lock (3), then the re-read. A check inside each
    attempt that fails with `DBIO.failed` propagates out of `attempt` (`:1035`) and is not retried. That is correct.
  - Output delete: `deleteWithPanelsInternal`/`deleteIfUnboundInternal` (`OutputRepository.scala:336-366`) run panels,
    then lock (3), then the delete. D5's placement is correct.
- **Transactions.** `DbContext.withSystemContext` = `privilegedDb.run(action.transactionally)` (`DbContext.scala:63-64`).
  Every listed write runs in one transaction.
- **READ COMMITTED determinism (D6).**
  - The revoke and downgrade touch only `resource_permissions`. There are no triggers on it (migration grep). The write
    transaction holds no lock on that table, so the separate-connection commit cannot block.
  - Item 1(b): the name read takes no lock and the transaction holds only `data_sources FOR KEY SHARE`. A raw
    `DELETE FROM pipelines` on another connection does not block, and `hel1629_lock_pipelines` then counts 0. This is
    deterministic.
  - Draft save has `DraftSaveHooks.at(Begin)` inside the transaction before the locks.
- **D3 workability (production callers).** Every production caller of the step and root writers goes through a service
  method that holds `user`:
  - `PipelineStepWrites`: update, delete, reorderTrunk, splice for duplicate
  - `PipelineStepCreate.scala:84,87`: attachTail, spliceInsertReporting
  - `PipelineRootWrites`
  - patch-set apply/undo, which call the services

  No production `Trusted` site is needed.
- **Grants for item 4.** V129:92 `GRANT SELECT, UPDATE ON panels TO helio_privileged`, and `hel1498_lock_panels` is
  SECURITY DEFINER, owned by `helio_privileged`, and runs `FOR UPDATE OF p`. V137:71 re-owns `hel1629_lock_pipelines`
  to `helio_privileged`. Both are real dependencies. Latest migration is V148, so no migration is needed.
- **R2 baseline.** `OutputService.delete` (`:296-305`) checks only `output.ownerId == user.id`, then deletes on the
  privileged pool with no recover. `PatchSetUndoService.deleteCreatedOutput` (`:145-155`) checks only RLS visibility.
  The gap the ruling targets is real.

### Verdict: REFUTE

The design is close and its core mechanism is sound. Three defects would make the executor either do large unneeded
work or produce evidence that cannot exist as specified.

### Change Requests

1. **D2/D3: drop the step-repo methods that no production code reaches, and correct the enumeration.**
   `PipelineStepRepository.insertInternal` (`:406`), `insertAtInternal` (`:606`) and `reorderInternal` (`:851`) have
   **zero callers under `backend/src/main/scala`**. A grep finds only `outputRepo.insertInternal` and doc comments.
   Step create goes through `attachTailInternal`/`spliceInsertReportingInternal` (`PipelineStepCreate.scala:84,87`),
   duplicate goes through `spliceInsertAtInternal` (which delegates to `spliceInsertReportingInternal`, `:692`), and
   reorder goes through `reorderTrunkInternal`.

   These three methods are not editor-reachable writes, but D2 lists them and the enumeration says they are. D3's
   "required parameter, no default" would force edits to about 179 `stepRepo.insertInternal(` test call sites across
   about 36 files, all for fixture setup, with no production benefit.

   Revise D2's path list to the production-reachable set:
   - `attachTailInternal`
   - `spliceInsertReportingInternal` (one check; `spliceInsertAtInternal` inherits it)
   - `updateInternal`
   - `deleteInternal` (each attempt)
   - `reorderTrunkInternal`
   - root add/remove, draft save

   State explicitly that the test-only methods are untouched, and why. Correct the enumeration line "create
   (attachTailInternal / spliceInsertReportingInternal / insertInternal / insertAtInternal)", which AC (2) requires to
   be accurate.

2. **D2: fix the refusal-mapping statement for step routes.** D2 says no-grant maps to "for step routes … the
   step-not-found message". That is wrong for two routes:
   - **step create** answers `Pipeline not found: <pipelineId>` (`PipelineStepWriteChecks.scala:94`)
   - **reorder** answers `Pipeline not found: <pipelineId>` (`PipelineStepWrites.scala:100`)

   Only update, delete and duplicate answer `Pipeline step not found: <stepId>`. Viewer refusals are
   `Forbidden("Forbidden")` for step/root routes and `Forbidden()` for draft save. Replace the prose with a per-route
   table (route → viewer body → no-grant body → PipelineGone body) so the executor reproduces each pre-check exactly.

   Also state that every typed refusal must be recovered before the existing generic handlers:
   - `.recover { case ex => classifyDbError(ex) }` in update, duplicate, create, reorder and root remove
   - `deleteStep` and `OutputService.delete` have no recover at all

   Without this the refusal would surface as 500.

3. **D4/D6: item 1(b)'s stated mutation cannot go red, and the step-write Boolean checks are untested new behaviour.**
   In root add, D2 places the D1 re-check immediately after `lockPipelines(RootAdd)`. D1's predicate reads
   `pipelines.owner_id` and returns `PipelineGone` when the row is missing. So the mutation D6 names for item 1(b),
   "ignore the Boolean", is masked: the re-check finds the row gone and still answers the 404, and the test stays green.
   The AC (1) mutation evidence would be vacuous.

   The design must:
   - name which check is the load-bearing gone-signal at each site;
   - give a mutation that actually turns 1(b) red. Either the mutation disables both the Boolean check and the
     predicate's `PipelineGone` branch, or the design makes the Boolean the only signal and the predicate never
     reports gone at that site.

   Separately, D2 says "after checking that call's Boolean (row gone -> the path's existing not-found)" for every step
   write. Today all of them discard it (`lockPipelines(...) andThen …`, `:416/632/757/805/866/901`). That is new
   behaviour on 7+ sites with no planned red test. Either drop it (and rely on the predicate's `PipelineGone`, with its
   mapping per route in the CR2 table) or add tasks covering it.

### Non-blocking notes

- **Race tests must be service-level.** `ApiRoutes.scala:266` builds `new PipelineRootRepository(dbContext)` with
  `Enforced` locks, and `TwoUserRlsApiFixture` builds `new PipelineStepRepository(ctx)` the same way. D6's locks
  subclass therefore cannot reach the route stack. Use `DraftSaveHarness` (injectable `locks`, `:29-36`) or an
  equivalent service-level harness, and assert the `ServiceError`. The tasks should say which.
- **Name the owner hazard in D3.** At every production call site `actingUserId` is the PIPELINE OWNER
  (`PipelineStepWrites.scala:39,206`; `PipelineStepCreate.scala:84,87`; HEL-1100), not the caller. Reusing it for the
  re-check would check the owner and always pass. D3 should name this hazard, not only the `""` default. The red tests
  would catch it, but the design should prevent it.
- **Side-effect timing in the `choose` override.** `choose` is evaluated while the for-comprehension is being built,
  before `privilegedDb.run`. That is still after the access check, so item 1(a) stays deterministic. The side effect
  should run inside the returned DBIO, or the timing should be documented.
- **Output-gone case in D5.** `deleteWithPanelsInternal` with the Output already gone has `pipelineId = None`
  (`:338`). Specify what the re-check does there; today the answer is 200 with `[]`.
- **D7 mutation for 3.2.** Dropping only `removeAction`'s `pipelineId` scoping leaves the guard green, because phase 1
  `roots.exists(_._1 == rootId)` (`PipelineRootWrites.scala:152`) already 404s. The mutation must defeat the phase-1
  membership check.
- **Item 4 ownership.** `helio_privileged` owns `hel1629_lock_pipelines`, so `has_function_privilege` is true by
  ownership. Consider also pinning `pg_proc.proowner`, because the SECURITY DEFINER owner is what the code relies on.
- **output-routes-api delta.** It is written as ADDED, while the base requirement "Output CRUD is scoped… DELETE …
  owner-only" stays unqualified. Consider a MODIFIED delta so the archived spec does not carry two partially
  overlapping DELETE rules.
- **D3 example.** D3's example `Trusted` site ("owner-only pipeline create's transactional path") uses
  `insertInternalAction`, which is not a re-checked method. Drop or replace the example.
