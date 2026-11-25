## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: worktree HEAD 737adb3525afa48d2f75576f948221910b732f8d (= main 737adb352); the change dir is untracked.
This was a read-only review. I started no servers and ran no sbt.

### Round-1 change requests: genuinely addressed?

- **CR1 (drop the unreachable step-repo methods; fix the enumeration): addressed.**
  - I re-grepped `backend/src/main/scala`. `PipelineStepRepository.insertInternal` (:406), `insertAtInternal` (:606) and
    `reorderInternal` (:851) have only their own definitions there. The other `insertInternal` hits are on
    `OutputRepository`.
  - D2 now lists exactly the production writers:
    - `attachTailInternal` (`PipelineStepCreate.scala:84`)
    - `spliceInsertReportingInternal` (`:87`); `spliceInsertAtInternal` (`:672-693`) delegates to it and is used by
      duplicate (`PipelineStepWrites.scala:206`)
    - `updateInternal` (`PipelineStepWrites.scala:38-39`)
    - `deleteInternal` (`:73`)
    - `reorderTrunkInternal` (`:112`)
    - root add and remove
    - draft save
  - D2 says the three uncalled methods are not changed, and why. Task 2.3 repeats it.
  - The evidence file's item 4 now carries a CORRECTION line saying the three methods have zero production callers.
- **CR2 (per-route refusal table; recover ordering): addressed.** I checked every row against the tree:
  - root add and remove 404 `Pipeline not found: <id>` (`PipelineRootWrites.scala:99,135`)
  - draft save 404 `Pipeline not found: <id>` and `Forbidden()` (`DraftSaveService.scala:57,62`).
    `Forbidden()` is the default of `Forbidden("Forbidden")` (`ServiceError.scala:24`), so both read the same.
  - create 404 `Pipeline not found` (`PipelineStepWriteChecks.scala:94`)
  - reorder 404 `Pipeline not found` (`PipelineStepWrites.scala:100`)
  - delete and duplicate 404 `Pipeline step not found` (`:57-62`, `:147-153`)
  - viewer refusal `Forbidden("Forbidden")` (`PipelineService.scala:289`, `PipelineStepWriteChecks.scala:190`)
  - Output delete 404 `Output not found` (`OutputService.scala:297-298`)

  D2 now requires the typed refusal to be recovered BEFORE the generic `classifyDbError` handlers. Those handlers exist
  in update `:49`, reorder `:131-134`, duplicate `:230`, create `PipelineStepCreate.scala:94` and root remove
  `PipelineRootWrites.scala:178-181`. D2 also says `deleteStep` and `OutputService.delete` gain a narrow recover;
  today neither has one.
- **CR3 (1(b) mutation could not go red; untested step Boolean handling): addressed.**
  - D4 now calls 1(b) defence in depth and records the expected results:
    - removing the Boolean check alone stays GREEN;
    - removing it together with mapping the predicate's `PipelineGone` to permitted goes RED.
  - I verified that the RED claim holds. With both detectors defeated, `nextPositionQuery` yields `None`, position
    becomes 0, and `rootsTable += row` violates the FK `pipeline_roots.pipeline_id REFERENCES pipelines(id)`
    (V98:80). `attachRoot` recovers only `PipelineCycleRejected` (`PipelineRootWrites.scala:116-118`), so the
    request fails as a 500. Task 4.3 records the evidence.
  - At the step sites, the new lock-Boolean handling was dropped; the Boolean "stays ignored exactly as today". The
    pipeline-gone case is now carried by the predicate's `PipelineGone`, mapped per route in the table.

Round-1 non-blocking notes:
- addressed:
  - service-level race tests (D6; constructors accept `locks`: `PipelineRootRepository.scala:25`,
    `PipelineStepRepository.scala:33`, `OutputRepository.scala:28`; the `PipelineDefinitionLocks` trait at `:73` can be
    subclassed)
  - the owner-id hazard (D3)
  - `choose` side-effect timing (D6)
  - the Output-gone case (D5)
  - the 3.2 mutation must defeat both checks (D7)
  - pinning `proowner` (D7)
  - the D3 example was removed
- not taken: the output-routes-api ADDED-vs-MODIFIED delta (still non-blocking; see below).

### What I verified on the current artifacts (with evidence)

- **Owner rulings.** The rulings recorded in design Context match the recorded `escalation.answered` events. I did not
  relitigate them.
- **Placement after lock (3): every site has a lock to sit after.**
  - root add `PipelineRootRepository.scala:101`
  - root remove `PipelineStepRepository.scala:1284-1288` (both lock orders)
  - draft save `DraftSaveTransaction.scala` after `abortIf(!locked)`
  - attachTail `:805`
  - reorderTrunk `:901`
  - update via `lockPipelineOfStep` (`:488-492`, which calls `locks.lockPipelines`, so the D6 override reaches it)
  - delete inside `deleteAttemptAction` (`:1058-1066`, both orders)
  - Output delete and undo (`OutputRepository.scala:343,359`)
- **D3 workability.** Every production caller has the acting `AuthenticatedUser` in hand: `PipelineStepWrites`
  update, delete, reorder and duplicate, `PipelineStepCreate` (it audits with `user`), `PipelineRootWrites`, the
  `DraftSaveTransaction.run` `actor`, `OutputService.delete`, and `PatchSetUndoService.deleteCreatedOutput`. The
  premise of the owner-id hazard is real: the existing `actingUserId` is `pipeline.ownerId`/`pipelineOwnerId` at every
  call site. `removeRootCascadeAction` has one production caller (`PipelineRootRepository.scala:178`); the
  `PipelineDraftWrites:252` hit is a doc comment.
- **Spec deltas.**
  - Neither `pipeline-root-write-access` nor `output-routes-api` has an existing requirement whose name collides with
    an ADDED one.
  - `pipeline-editor-grant-recheck` is a new capability, with no base spec.
  - The scenarios match the D2 table and D5.
- **Item 4.**
  - V129:92 `GRANT SELECT, UPDATE ON panels TO helio_privileged`.
  - V137:40/71: the signature `hel1629_lock_pipelines(text[], text[])` matches the one D7 quotes, and the function is
    owned by `helio_privileged`.
  - The latest migration is V148, so no migration is needed.
  - `PipelineRootWriteGrantsSpec` uses `ProductTelemetryDbHarness` and its `has(...)` helper, as D7 assumes.
- **No placeholders or TBDs.** There are no internal contradictions between proposal, design, tasks and specs, and
  every AC (1)-(4) maps to a task: 1.1/2.2/4.3, 1.2/2.1/2.3, 1.3/2.4/3.3, 3.1/3.2, 3.4.

### Verdict: CONFIRM

### Non-blocking notes

- **Step-gone at update/delete.** `updateInternal` locks through `lockPipelineOfStep`, which never exposes the
  pipeline id. To run the predicate, the executor has to restructure it: read the id, lock, then re-check. When the
  step row is gone, no pipeline id exists, so the predicate cannot run. Keep today's `None` → `Pipeline step not found`
  there, mirroring D5's Output-gone rule.
- **Viewer-downgrade coverage.** Task 1.2 asks for a viewer-downgrade (403) race test only for "at least root add and
  one step write". The 403 mapping is a separate recover at each route: update, create, reorder, duplicate, delete,
  root remove and draft save. Consider one downgrade case per recover site, so each 403 row in the D2 table is pinned.
- **D6 example.** `DBIO.from(future)` takes an already-started Future, so it is eager wherever it is built. Its listing
  as an example sits awkwardly with the "never eager" rule. Prefer
  `DBIO.successful(()).flatMap(_ => DBIO.from(...))` or a `SimpleDBIO`. The separate-connection commit also needs a
  connection the in-flight transaction does not hold; check the test pool size.
- **Item 4 mutation feasibility.** The harness migrates as a NOSUPERUSER role, which may not be able to
  `REVOKE`/`ALTER FUNCTION ... OWNER` on `helio_privileged`. If it cannot, mutate the assertion target instead (wrong
  privilege or wrong role) and say so.
- **Duplicate DELETE rule in the specs.** The output-routes-api delta is still ADDED, beside the unchanged base "Output
  CRUD ... DELETE owner-only". The same rule is also restated in `pipeline-editor-grant-recheck`. That is harmless, but
  the archived specs will carry the DELETE rule in two capabilities.
- **Race-only outcome changes.** These are race-only and allowed by AC(2), but the PR body should state them:
  - reorder on a pipeline deleted mid-request becomes 404 instead of today's 422 permutation error;
  - step create on a pipeline deleted mid-request becomes 404 instead of a classified FK error.
