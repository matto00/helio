## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `cf0ca498755bfaf613119105dbad0e90ecbb60eb`. The diff base was resolved live to `14c08def8a69f78fe1f81fcb86a7a3d928d06ab3` (origin/main). The cycle-2 delta (`ba48a3f04..cf0ca4987`) touches two files: `PipelineRootRepository.scala` and `PipelineRootRemoveAtomicitySpec.scala`.

### Phase 1: Spec Review — PASS
Issues: none. Cycle 1's Phase 1 findings still hold. Design D5's "asserting 404" is now met at the service seam.

### Phase 2: Code Review — PASS

Gates, run by me in this worktree:
- `cd backend && sbt testFull` (HELIO_TEST_JVM_XMX=3g, nice -n 19): **exit 0**, "Tests: succeeded 9433, failed 0, canceled 5". That is one more than cycle 1's 9432. The 5 canceled are the same env-gated measurement tests as before.
- Both `PipelineRootRemoveAtomicitySpec` cases ran and passed, including the new "should answer 404 Root not found (never a 500), as an editor, when a racer removes the root after phase 1, and roll the cascade back".
- `check-scala-quality.mjs`: clean. `check-openspec-hygiene.mjs`: clean.

How each cycle-1 change request was resolved:
1. **The 404 mapping now has a test.** The new test uses a real `PipelineService`. Its `PipelineRootRepository` subclass overrides `removeRoot` and injects an in-transaction root delete after the cascade, which reproduces the race. The editor actor (`userB`, granted editor) gets `Left(ServiceError.NotFound("Root not found: <r2>"))`, the snapshot of t4 is back, and `storedState` is unchanged. Phase 1 runs before the hook while the root still exists, so the 404 can only come from the `RootAlreadyRemoved` case at `PipelineRootWrites.scala:216`. Deleting that line would send the exception to `classifyDbError`'s `case other` (an `InternalError`), which this assertion rejects. So the mutation is red by construction. I did not run the mutation myself.
2. **The `run` parameter is removed.** `removeRoot` now calls `ctx.withSystemContext` directly. A grep for remaining usages finds none.
3. **Both stale comments are fixed** (`PipelineRootRepository.scala:87` and `:155`).

No new issues in the delta.

### Phase 3: UI Review — N/A
No UI trigger paths changed (this is a backend-only diff). AC (e) is covered on NOBYPASSRLS by `DraftSaveRlsSpec:15-25`.

### Overall: PASS

### Non-blocking Suggestions
- `PipelineRootWriteGrantsSpec` could also assert `UPDATE` on `panels` and `EXECUTE` on `hel1629_lock_pipelines`. This is defence in depth only; both already run on the privileged pool elsewhere.
