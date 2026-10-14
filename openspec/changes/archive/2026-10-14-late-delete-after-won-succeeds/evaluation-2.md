## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `5a9e890c0c475e27c07e116c9ef07a1c41229abb` (commits 4b3eff617 and 5a9e890c0 since the cycle-1 head
b69831ec6). The live-resolved base is still `273c0b0c9c884a17210f58db811a3bb02718415d`. The worktree was clean
(`git status --porcelain` empty) both at the start and after the last gate run, and HEAD did not move during review.

### Concurrent-executor check (orchestrator request)

- **Production diff since b69831ec6 is comments and named arguments only.** `PipelineRunDeletedRecovery.scala` is
  byte-identical to b69831ec6 (`git diff --quiet` exit 0). Its four load-bearing lines are present at :36, :37, :42
  and :49: `NonFatal(original)`, `settle(siblings)`, `Success(None) if isWon` and `RunNoLongerOpen(RunState.Missing)`.
  `PipelineRunSucceededWrites.scala` changed only in two places: the `recover` call now uses named arguments, and two
  comments were rewrapped or corrected. No logic changed.
- **No stray mutation is committed.** That follows from the identical recovery file above, the clean tree, and the
  mutation runs below going red as expected.
- **Nothing was lost in the split.** The sorted test names (`should`/`in` blocks) of the old `LateFinisherRunSpec` at
  b69831ec6 and of the new `LateFinisherRunSpec` + `LateFinisherDeleteAfterWonSpec` are identical (`diff` empty).
  There are 16 tests, as before (10 + 6). Across all 4 testFull shards the totals match cycle 1: 8068 tests passed,
  4 canceled. The suite count went from 612 to 613, because one spec became two.

### Evidence re-run by the evaluator

- `testOnly LateFinisherRunSpec LateFinisherDeleteAfterWonSpec`: 3 consecutive runs. Each run: 2 suites, 16 passed, 0 failed, exit 0.
- Mutations, each run in a throwaway detached worktree at 5a9e890c0 (removed afterwards; `git worktree list` no longer
  shows it):
  - Drop the `won` check (`case Success(None) =>`): RED, 13/16. The tests that failed span both split specs: the
    item-2 delete-in-window test and the D7 delete-before-list test in `LateFinisherRunSpec`, and the D1b test in
    `LateFinisherDeleteAfterWonSpec`.
  - Narrow the recovery to `case original: RunNoLongerOpen`: RED, 14/16. The binary-ref-after-won test and the D1b
    test failed.
- Full `sbt testFull` in WORKTREE_PATH: 4 foreground shards, one at a time (`HEL924_TEST_GROUP_CONCURRENCY=1`,
  `HELIO_TEST_JVM_XMX=3g`, `nice -n 19`). All exited 0 with 0 failures:
  | Shard | Suites | Tests passed | Canceled |
  | ----- | ------ | ------------ | -------- |
  | 0     | 153    | 2035         | 3        |
  | 1     | 153    | 2019         | 0        |
  | 2     | 153    | 1921         | 0        |
  | 3     | 154    | 2093         | 1        |
- `check-scala-quality.mjs`: clean. None of the LateFinisher* files is flagged any more. The only touched file still
  flagged is `PipelineRunSucceededWrites.scala` at 358 lines, which was already over budget and is soft.
  `check-openspec-hygiene.mjs`: clean.

### Cycle-1 change requests

1. Task 1.3a (split): DONE. The fixture moved to `LateFinisherSpecBase.scala` (204 lines). The test files are now
   `LateFinisherRunSpec.scala` (217) and `LateFinisherDeleteAfterWonSpec.scala` (102), all under ~250. The design.md
   D5 note is updated.
2. Inline `scala.util.Success`: DONE. `LateFinisherDeleteAfterWonSpec.scala:7` imports `scala.util.Success`. A grep
   for inline `scala.util.`, `java.util.` and `com.helio.` qualifiers outside imports in the three LateFinisher* files
   finds nothing.
3. Stale comments: DONE.
   - `LateFinisherDeleteAfterWonSpec.scala:14`: the divider now says the delete may land anywhere after the run's own
     write and the answer is success.
   - `PipelineRunSucceededWrites.scala:294-296`: the HEL-1366 comment now says a failed chain is settled first. That
     matches the code: `recover` wraps every NonFatal failure and waits for the siblings and `updateRun` before
     returning.

### Phase 1: Spec Review — PASS
Issues: none. All acceptance criteria and constraint C1 hold, as in cycle 1. The task list matches what was implemented.

### Phase 2: Code Review — PASS
Issues: none blocking. The split is a pure move: the same seams and test bodies, with `private` changed to
`protected` and `abstract class LateFinisherSpecBase`.

### Phase 3: UI Review — N/A
Backend only. No file matching the Phase 3 triggers changed, and no servers were started.

### Overall: PASS

### Non-blocking Suggestions
- `evidence.md` "SUPERSEDED in cycle 2" gives the split files as 236 and 128 lines. They are actually 217 and 102.
- `files-modified.md`: the `LateFinisherRunSpec.scala` entry still lists the flipped HEL-1544 pin, the forced-ordering
  tests, the narrowness control and D1b. Those now live in `LateFinisherDeleteAfterWonSpec.scala`. Trim that entry so
  the PR description doesn't misattribute them.
- D2 (waiting for the other writes before answering) is still untested. Dropping the wait still leaves every test
  green. This is honestly recorded in evidence.md as a known gap.
- The divider at `LateFinisherDeleteAfterWonSpec.scala:14` is about 170 characters wide. Section dividers in a
  102-line file also go against CONTRIBUTING's "~1,000 lines" guidance (this is a style carried over from the old file).
- `LateFinisherSpecBase` still names its ActorSystem `"late-finisher-run-spec"` for both specs. This is harmless,
  because the names don't need to be unique, but it is misleading in logs.
