## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 933f9d06fe806489cc1b10d6cbb06c24ddf4a2d4. Base resolved live with `resolve-review-base.sh`:
609e62b6d917243355a179fa8a26318c04898c27.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/guard-recovery-sibling-settle/HEL-1594`.
- **Diff scope:** `git diff BASE...HEAD --stat`. Only three test files under `backend/src/test` changed, plus openspec
  artifacts. `git diff BASE...HEAD -- backend/src/main` is empty (C2, AC3 "never committed").
- **Premise (AC5), checked against production code:**
  - `PipelineRunDeletedRecovery.scala:35-58`: `recover` runs `settle(siblings)` first, then `won`, then
    `findByIdInternal`.
  - `PipelineRunSucceededWrites.scala:277-291`: `materializedWrites` is the first step of the `for`.
    `binaryRefsUpsert` is eager and appears in `siblings`.
  - So D2 is observable, and the design's Context section is accurate.
- **Seams (AC1, C4):**
  - `LateFinisherSpecBase` adds `binaryEntered`, `binarySettled` and `nodeWriteFailed`. Each is bound to a local at
    call start in `HookBinaryRepo.overwriteForNode` and `HookSnapshotRepo.overwriteRowsWith`, and each is replaced in
    `resetSeams()`.
  - `nodeWriteFailed` uses `.andThen { case Failure(_) => ... }`, so the original failure propagates unchanged.
- **Test (AC2, AC4, C1):** `LateFinisherDeleteAfterWonSpec.scala:74-105`.
  - Every ordering is forced by a promise: `written`, `release`, `entered` and `failed`.
  - The only time bound is the 3 s absence window. It cannot decide an ordering on unmodified code.
  - No `Thread.sleep` or `eventually` was added: a grep of the added lines returns zero hits.
  - The post-answer flag is set through `answer.andThen`, and the test awaits that before reading the flag. This
    ordering is correct.
  - The prerequisite awaits use `Await.ready(..., 30.seconds)`. A missed prerequisite therefore throws instead of
    passing vacuously.
- **Green on unmodified code, run by me in this worktree, 4 live runs** (`nice -n 19`, foreground, `testOnly` on the
  3 late-finisher specs):
  - Each run printed `Total number of tests run: 24` / `Tests: succeeded 24, failed 0`, and the new test and both new
    isolation tests appear by name.
  - Every log contains `.../worktrees/task/guard-recovery-sibling-settle/HEL-1594/backend/` paths, and its logback
    init timestamps fall inside my run window (for example 08:27:43). Each log also shows 4 live
    `HEL-1564: pipeline ... was deleted` WARN lines.
  - Conclusion: these were real executions, not cache replay (HEL-1595).
- **Red when D2 is removed (AC3).** In a throwaway `git worktree add --detach` copy of 933f9d06f
  (`scratchpad/skeptic-hel1594-final-mut`, now removed and pruned), I replaced `settle(siblings).flatMap(_ =>` with
  `Future.unit.flatMap(_ =>`.
  - Run twice; both RED at the step-4 absence assertion: `Expected exception java.util.concurrent.TimeoutException to
    be thrown, but no exception was thrown (LateFinisherDeleteAfterWonSpec.scala:97)`, `Total number of tests run: 7`,
    `Tests: succeeded 6, failed 1`.
  - The logback paths are the copy's own `backend/target`, and the timestamps are live (08:28:29 and 08:28:38).
- **My extra probe, narrower mutant:** I kept `settle` but dropped only `binaryRefsUpsert` from `siblings` in
  `PipelineRunSucceededWrites.scala:290`.
  - Result: RED at the same line 97, 6/1, live at 08:29:07.
  - So the test guards the specific held sibling, not just the existence of the `settle` call.
- **C5 isolation claims.** I reverted the `nodeWriteFailed` and `binarySettled` captures in the throwaway copy's
  `LateFinisherSpecBase`.
  - `LateFinisherSeamIsolationSpec` went RED on both new tests: `:120` and `:137`, `false was not equal to true`,
    5/2, live at 08:29:29.
  - The `binaryEntered` capture is honestly disclosed as unprovable by reversion. It is completed synchronously at
    call start, so the disclosure is correct.
- **Gates:**
  - `npm run check:scala-quality` reports `clean`, exit 0. The touched files have 234, 141 and 142 lines, all under
    the 250 soft budget.
  - `npm run check:openspec` reports clean, exit 0.
- **Worktree state after my probes:**
  - `git status --short` shows only the evaluator's untracked `evaluation-2.md`.
  - HEAD is unchanged at 933f9d06f.
  - `git worktree list` has no leftover copy.
- **Evidence claims in `evidence.md` and `evaluation-2.md`:** they match what I reproduced (line 97, the 6/1 and 24/0
  counts, the isolation lines 120 and 137). Nothing relies on mtime ordering, and no gate defect applies.

### Verdict: CONFIRM

### Non-blocking notes
- The mutant-detection sensitivity depends on the 3 s window. On a heavily loaded machine, a mutant could in
  principle answer later than 3 s and pass falsely. This affects only the mutation proof, never the stability of the
  unmodified test, and design.md documents it.
- The `binaryEntered.isCompleted shouldBe false` assertion after the reset cannot fail by construction. The test
  comment says so.
