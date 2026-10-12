## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 60bcd8646f30a8c840048b1bbc24231d7df57ad0. The change dir is untracked; the artifacts were reviewed as they sit on disk. All findings come from reading the code. No live probes were run.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/editor-run-baseline-statuses/HEL-1503`.

#### Round-1 change requests

- **CR1 (harness name): addressed.**
  - D6 and task 1.1 now name `PipelineRunEditorPersistenceSpec.scala`.
  - That file exists, with the advisory-lock-holder pattern at :442-458 and `StaleGrantPipelineRepository` at :494.
- **CR2 (owner-path read and classification): addressed.**
  - D3 states the exact plain-SQL `FOR KEY SHARE` read.
  - It gives the outcome for each case: no row, own row, other owner's row.
  - It notes that under RLS the owner path sees a non-owned row as absent, so a non-owner gets `PipelineGone`.
  - It keeps the `PipelineRunRepositorySpec` :629 pin. That is correct: the spec runs as superuser (`postgres`, :30-36), so a non-owner still sees the row, and `NotAuthorized` remains the right result there.
  - The bad fallback sentence is gone.
- **CR3 (23503 mapping): addressed.** The mapping is dropped and the reason is recorded: the row lock makes 23503 unreachable. D6(e) is now a deterministic lock test.
- **CR4 (dry-run deletion case): addressed nominally** as D6(g). However, (g) inherits the defect in CR2 below.

#### D3 lock order: sound

- `PipelineRepository.delete` (:482-487) is a single owner-scoped `DELETE`. It takes no advisory lock.
- The only other users of `pg_advisory_xact_lock` are `PipelineCycleGuard` and `ProductEventRepository`, which use different keys.
- Admission order is: `FOR KEY SHARE` on its own pipeline row, then the owner-keyed advisory lock, then the count, then an insert whose foreign-key check re-takes `KEY SHARE` on the same row.
- No transaction holds the advisory lock while waiting on a row lock that a `DELETE` could hold. So no cycle is possible.
- Ordinary `UPDATE`s of `pipelines` take `FOR NO KEY UPDATE`, which does not conflict with `KEY SHARE`.

#### RLS on the owner path: matches the design

- V39:87-89 `pipelines_update` USING `owner_id = current_user_id`. The owner passes it.
- Later migrations (V73, V99/V100) do not redefine the `pipelines` policies.

#### Admission consumers

- The only consumer of `ConcurrencyCapResult` is `PipelineRunExecutor.scala:159-170`.
- The `submit` callers (scheduler, auto-run firer, hooks, proposal) do not branch on `Forbidden` or `NotFound`, so changing 403 to 404 has no knock-on effect there.

#### New: the pre-admission 422 window

`PipelineRunService.submit` (:190-205) calls `runPipeline`. `runPipeline` (`PipelineRunExecutor.scala:52-56`) resolves the roots first, through `listRootDataSourceIdsInternal`, and returns `UnprocessableEntity("DataSource not found for pipeline")` when the root list is empty.

- `pipeline_roots.pipeline_id` is `ON DELETE CASCADE` (V99 header, :19-23). So a pipeline deleted after the ACL read but before root resolution answers **422**. That request never reaches D3's admission or D4's re-check.
- This is the larger part of the race window, because the ACL read comes immediately before root resolution.
- The natural seam is a `findByIdShared` override, mirroring `StaleGrantPipelineRepository`. Applied to D6(c)/(d)/(g), it deletes inside exactly this window. The tests would then observe 422, not 404.

#### New: D2's factual premise is wrong

- `PipelineAnalyzeReads.scala:74-77` derives the current root schema with `dataSourceRepo.findByIdOwned(dsId, user)`, which is owner-filtered for the analyzing user. Only the root id list comes from `*Internal` (`listRootDataSourceIdsInternal`).
- The comment at :70-72 confirms this is deliberate.
- Reachability: `PipelineRootWrites.addRoot`/`attachRoot` (:109-139) lets an editor bind a root to the editor's own source (`findByIdOwned(dsId, user)`). An editor can also remove roots. So a pipeline whose primary root is not owned by its owner is reachable.

#### D4 placement

- `preExec`'s dry branch (`PipelineRunExecutor.scala:148-171`) is the right slot, before the `queued`/`running` publishes at :176-177.
- The `pipelineRunRepo == null` guard is specified.
- The `expectedForbiddenProducers` 1 → 2 change is planned. Classifying it in design.md follows the HEL-1492 precedent (`ExistenceNotLeakedRoutesSpec.scala:530-532`).

### Verdict: REFUTE

### Change Requests

1. **AC2 and the new `pipeline-run-execution` requirement are not met for deletions before root resolution (design.md D3/D4/D6, tasks 3.x/4.x).**
   - The problem:
     - A pipeline deleted after `submit`'s `findByIdShared` but before `resolveAllRootDataSourcesInternal` gets `422 UnprocessableEntity`, from `PipelineRunExecutor.scala:52-56`.
     - Both the ticket's AC2 and the spec delta promise `404` for any deletion "after the access check but before admission", real or dry.
     - Neither D3 (admission) nor D4 (which sits in `executeRun`, after root resolution) covers this window.
   - Required:
     - (a) Close the window. For example, in `runPipeline`'s `roots.isEmpty` branch, run a privileged existence read of the pipeline. If the row is gone, return `ServiceError.NotFound("Pipeline not found: <id>")`. Otherwise keep today's 422 for a genuinely rootless pipeline. The design may instead reject this approach, but it must state the alternative.
     - (b) State the seam location for D6(c)/(d)/(g):
       - Make one seam delete at the ACL read: a `findByIdShared` override that deletes the pipeline and then returns it. This exercises (a).
       - Make a second seam delete after root resolution, e.g. a `stepRepo.listByPipelineInternal` override, so the D3 admission `PipelineGone` and D4 `PipelineGone` arms are reached at service level.
       - Without both, a test can pass on the wrong arm, or fail on 422 against a correct D3.
     - (c) Add the matching mutation to D6: reverting (a) to an unconditional 422 must fail the seam-at-ACL case.

2. **D2's rationale is factually wrong, and the uniform `findByIdInternal` read changes owner-visible drift.**
   - What design.md gets wrong:
     - Context bullet 2 and D2 say the analyze/compare side "derives the current schema through the same `*Internal` resolution". It does not. `PipelineAnalyzeReads.scala:77` uses `findByIdOwned(dsId, user)`.
     - So capture (`findByIdInternal`) and compare (`findByIdOwned` as the analyzer) are *not* one derivation. The spec delta's "the same derivation the analyze path uses" becomes false.
   - What breaks for the owner:
     - Take a pipeline whose primary root is bound to a source the owner does not own. This is reachable: an editor can add a root bound to their own source (`PipelineRootWrites.attachRoot`) and remove the original root.
     - Today: owner run stores `[]`, owner analyze compares `[]` with `[]`, so no drift is reported.
     - Under D2: the baseline stores the editor-source columns, the owner's analyze reads `[]`, so every column is reported **removed**.
     - That is a new false drift. D2 instead claims it "is a fix in the same class, not a regression".
   - The same mismatch hits an editor run under any variant that reads with privilege.
   - Required:
     - Make the capture mirror the compare exactly as the pipeline owner sees it. For example, read the source as the PIPELINE OWNER on both branches: `findByIdOwned(sourceDataSourceId, <principal for pipeline.ownerId>)`, or `findByIdInternal` filtered to `ds.ownerId == pipeline.ownerId`, else `[]`. This still satisfies AC1 (the source is owned by the pipeline owner, never `[]` merely because the *submitter* lacks ownership) and keeps capture and compare symmetric.
     - Correct the Context and D2 text.
     - Adjust D6(b)'s mutation, e.g. reading as the submitter (`findByIdOwned(.., user)`) fails it.
     - Add a guard case: an owner run whose primary root is not owner-owned stores `[]` and reports no drift. The uniform-`findByIdInternal` mutation fails it.
     - Alternatively, if the planner wants the uniform read, state the owner-visible false-drift consequence explicitly and justify it. That would be an owner-visible behaviour change outside AC1 and needs to be acknowledged, not called a fix.

### Non-blocking notes

- **D6(e) synchronisation.**
  - The design says the admission "takes the key-share row lock then blocks on the advisory lock", but it does not say how the test knows the admission has got that far before issuing the `DELETE`.
  - The existing pattern uses `Thread.sleep(1500)` (:449). If the `DELETE` runs first, the test fails falsely (it fails red, not falsely green).
  - Prefer polling until the admission's backend shows an ungranted advisory lock in `pg_locks` (`locktype='advisory' AND NOT granted`) before running the `lock_timeout` `DELETE`.
- **D4 result type.**
  - "The same three-way result (`Authorized` / `NotAuthorized` / `PipelineGone`)" does not say which ADT. `ConcurrencyCapResult` has no `Authorized`.
  - Name a separate small ADT (or `Option[Boolean]`-style return) so the admission match at `PipelineRunExecutor.scala:158-171` does not gain an arm it can never see.
- **Existing pin to invert.** `PipelineRunEditorPersistenceSpec.scala:427-432` ("answer NotAuthorized for a pipeline that no longer exists, on both the grantee and the owner path") becomes `PipelineGone` on both paths. Name it in task 6.1 alongside the generic grep instruction.
- **Named mutations.** D6 names explicit mutations only for (a), (b) and (e). Cases (c), (d), (f) and (g) rely on being red on main, which is adequate. Still, list one mutation per case in red-run.md, e.g. collapsing `PipelineGone` into `NotAuthorized` fails (c)/(d)/(g), and removing the D4 call fails (f).
