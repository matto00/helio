## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `5a9e890c0c475e27c07e116c9ef07a1c41229abb`. The review base was resolved live with `resolve-review-base.sh`
as `273c0b0c9c884a17210f58db811a3bb02718415d`. This change is backend only (no UI), so step 4 is skipped.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/late-delete-after-succeeded-write/HEL-1564`.
- **Tree state and the concurrent-executor concern.**
  - `git status --porcelain` shows only the untracked `evaluation-2.md`. There are no modified tracked files and no stashes.
  - `git diff b69831ec6 HEAD -- backend/src/main` covers one file, `PipelineRunSucceededWrites.scala`, +6/-5. The changes
    are the switch to named arguments in the `recover` call and comment rewraps. No logic changed.
  - `PipelineRunDeletedRecovery.scala` has not changed since the cycle-1 commit.
  - Nothing from the concurrent executors survived: no stray mutation and no half-applied edit.
- **AC 1, success in both orderings.** `PipelineRunDeletedRecovery.recover` (new file, lines 33-55) wraps the whole
  success chain. It recovers to `None` (success) only when two things hold: `updateRun` returned `won = true`, and
  `pipelineRepo.findByIdInternal` returns `None`. A recovered chain is an ordinary success, so `publishTerminalAfter`
  publishes `succeeded` once.
  - The ordering "delete before the Output list is read" already succeeded and still does.
  - The ordering "delete after the list is read" now succeeds too.
  - Two more orderings are covered and pass: the delete landing between node writes, and an un-guarded post-fold
    binary-ref FK failure.
- **AC 2, the 404-pinning test is flipped.** `LateFinisherDeleteAfterWonSpec` line 28 now asserts `Right`, plus exactly one `succeeded`.
- **AC 3, D7 and first-terminal-write-wins are kept.**
  - Every HEL-1518 test is still present and green with unchanged assertions. I diffed the test inventory: the old spec
    had 16 test names, and all 16 are now in the two split specs.
  - The item-2 delete test only gained a `terminalGate` sequencing, which is needed because the run's own write is eager.
  - The `won=false` branch never recovers to success. D1b changes a non-`RunNoLongerOpen` failure on a deleted pipeline
    into `RunNoLongerOpen(Missing)`, which maps to 404 with no publish.
- **AC 4, what gets written is decided and documented.** It is decided in design.md D3. It is documented in the spec
  delta scenario "Pipeline deleted after the run's own succeeded write won", in the scaladoc, and in a WARN log line.
  - Nodes committed before the delete keep their `node_snapshots`.
  - History and payload rows go with the cascade.
  - Nothing is written after the deletion is observed.
  - The between-nodes test asserts all of this: 3 snapshots from exactly 1 node, and 0 history and 0 payload rows.
  - The spec delta's MODIFIED requirement keeps all 6 canonical scenarios and adds 2.
  - `openspec validate --strict` prints "Change 'late-delete-after-won-succeeds' is valid".
- **AC 5, red-first under forced orderings.** I reproduced this myself in a throwaway detached worktree at HEAD, with
  the production code restored to base (I restored `PipelineRunSucceededWrites.scala` from 273c0b0c9 and removed
  `PipelineRunDeletedRecovery.scala`).
  - Command: `testOnly LateFinisherRunSpec LateFinisherDeleteAfterWonSpec`.
  - Result: "Tests: succeeded 12, failed 4". The 4 failures are the 4 intended tests, failing for the intended reasons:
    - flipped delete-after-list: `false was not equal to true`
    - between-nodes: `Success(false)`
    - binary-ref after won: raw `binary_refs_pipeline_id_fkey` PSQLException
    - D1b: the FK exception instead of `Left(NotFound)`
  - The narrowness control was green on base, as designed: it pins today's behaviour.
  - Orderings are forced with promises and seams (`terminalWritten`, `terminalGate`, `afterNodeWrite`, `foldDone`,
    `beforeBinaryWrite`). No sleep decides an ordering. The only sleeps are the existing settle and poll windows for
    observing events.
  - The throwaway worktree was removed afterwards; `git worktree list` no longer shows it.
- **Green on HEAD, run fresh by me** (same command, `nice -n 19`, `HELIO_TEST_JVM_XMX=3g`): "Tests: succeeded 16,
  failed 0 ... All tests passed", exit 0.
- **Narrowness.** "still fail the submit and still publish succeeded" uses a real FK failure while the pipeline still
  exists, and it passes on HEAD. So the recovery does not swallow errors on a live pipeline. The evaluator's mutation
  runs, which I did not re-run, are consistent with the predicate.
- **Quality gate:** `check-scala-quality.mjs` reports "clean (249 soft warning(s))".
- **Full suite.** I did not re-run `testFull`. evaluation-2 pastes per-shard counts (4 shards, 8068 passed, 0 failed)
  for this exact HEAD. Production logic is unchanged since cycle 1, and its full run was also green. I accept the
  pasted output.

### Judgment on D2 (settle-before-answer) being untested

Leaving D2 untested is acceptable here and does not block.
- On the path this ticket adds (the write won and the pipeline is gone), any sibling write still in flight targets a
  deleted pipeline. Those writes touch zero rows, self-recover, or FK-fail. A subscriber reacting to `succeeded` has no
  live state that the timing could make stale.
- On the live-pipeline failure path, settling only narrows a pre-existing edge that HEL-1366 already documented, where
  the event could fire while `updateRun` was still in flight. It does not create a new risk.
- By reading the code, the settle covers every eager future: the six siblings, plus `updateRun` through
  `won.transformWith`. `trunkLastStepIdFut` is nested inside `binaryRefsUpsert`.
- The cost: the spec sentence "after its remaining writes have settled" is a SHALL with no test that would fail if it
  broke. The evaluator showed that dropping `settle` is a mutation that survives. This is recorded as a known gap, and
  a follow-up is reasonable.

### Verdict: CONFIRM

### Non-blocking notes
- D2 has no failable test. A follow-up could add a slow-sibling seam, for example a wrapped `dataSourceRepo` delaying
  `baselineUpsert`, and assert that `succeeded` is not observed before it completes.
- Accepted limit, documented in the scaladoc: pipeline existence is checked when the recovery runs, so an unrelated
  failure on a live pipeline that is deleted before the check is answered as success. That matches the ruling's end
  state.
- `PipelineRunSucceededWrites.scala` is still over the soft line budget (358 lines). This was pre-existing.
