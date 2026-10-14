## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b69831ec666ae3181b9e65579398e3cdd18bdd0f` against the live-resolved base `273c0b0c9c884a17210f58db811a3bb02718415d`
(`resolve-review-base.sh`, exit 0). Backend-only diff: `PipelineRunDeletedRecovery.scala` (new, 59 lines),
`PipelineRunSucceededWrites.scala` (+13/-2), `LateFinisherRunSpec.scala` (+127/-10), plus the change's openspec artifacts.

### Evidence re-run by the evaluator (not taken from evidence.md)

- `LateFinisherRunSpec` on HEAD: 16/16 green, then 3 more consecutive runs, 16/16 each (4/4 total).
- **Red-first, re-verified** in a throwaway detached worktree at HEAD with ONLY the two production files restored to
  base (`PipelineRunSucceededWrites.scala` from 273c0b0c9, `PipelineRunDeletedRecovery.scala` removed; tests at HEAD):
  12 passed, 4 failed. The four failures are the flipped HEL-1544 test (`false was not equal to true`, :314), the
  between-nodes test (`Success(false)`, :325), the binary-ref-after-won test (raw `binary_refs_pipeline_id_fkey`
  PSQLException, :344) and the D1b test (same raw FK instead of `Left(NotFound)`, :378). This matches evidence.md.
- **Mutations, re-verified** (same throwaway worktree, each applied to `PipelineRunDeletedRecovery.scala` alone):
  1. `case Success(None) if isWon` -> `case Success(_) if isWon` (drop pipeline-gone check): RED, narrowness control (:361). 15/16.
  2. -> `case Success(None) =>` (drop `won` check): RED, item-2 delete-in-window, D7 delete-before-list, D1b. 13/16.
  3. `case NonFatal(original)` -> `case original: RunNoLongerOpen` (narrow recovery): RED, binary-ref-after-won and D1b. 14/16.
  4. D1b branch -> `Future.failed(original)`: RED, D1b test. 15/16.
  5. (extra, not in the plan) `settle(siblings).flatMap` -> `Future.unit.flatMap` (drop D2 settle): **survives, 16/16 green** (see suggestions).
  The throwaway worktree was removed (`git worktree remove --force`); `git worktree list` no longer shows it.
- **Orderings are forced, not slept**: every HEL-1564 interleaving is driven by promises/seams (`terminalWritten`,
  `terminalGate`, `foldDone`, `afterNodeWrite`, `beforeBinaryWrite`); the only sleeps are the pre-existing
  `eventsOf` 300 ms absence-settle window and the bounded `awaitSucceeded` poll, neither of which orders anything.
  Test 3 additionally asserts all 6 node snapshot rows exist before the delete (C1).
- **Full backend suite** `sbt testFull` in WORKTREE_PATH, 4 foreground shards one at a time (`HELIO_TEST_SHARD_COUNT=4`,
  `HEL924_TEST_GROUP_CONCURRENCY=1`, `HELIO_TEST_JVM_XMX=3g`, `nice -n 19`): shard 0 exit 0 (152 suites, 2175 passed,
  4 canceled), shard 1 exit 0 (153, 1859), shard 2 exit 0 (153, 1802), shard 3 exit 0 (154, 2232). 0 failures.
- `node scripts/check-scala-quality.mjs`: clean (soft warnings only, incl. `LateFinisherRunSpec.scala is 499 lines`,
  `PipelineRunSucceededWrites.scala is 357 lines`). `node scripts/check-openspec-hygiene.mjs`: clean.

### Phase 1: Spec Review — FAIL

- AC "answer success in both orderings": PASS (flipped test + delete-before-list test, both exactly one `succeeded`).
- AC "flip the 404-pinning test": PASS.
- AC "keep D7 and first-terminal-write-wins": PASS (all D7/item-1/item-2/reap tests green; mutation 2 proves `won` is load-bearing).
- AC "decide and document what is written": PASS (design.md D3, spec delta scenario, between-nodes test pins exactly one node's 3 snapshot rows and 0 history/payload).
- AC "red-first under forced orderings": PASS (re-verified above).
- CONSTRAINT C1 (force every concurrent write; exact `succeeded` counts): PASS.
- Spec delta: MODIFIED header matches `openspec/specs/pipeline-run-reaper/spec.md:56`; main spec unedited pre-archive (expected).
- **Issue — task 1.3a marked `[x]` but not done as planned.** design.md D5 and tasks.md 1.3a both say: if the additions
  breach the test-file budget, move the delete-after-won tests into a sibling spec sharing a fixture trait. The file went
  387 -> 499 lines (crossing CONTRIBUTING.md:24's ~400-line line, where the rule is "propose a split in the PR
  description rather than adding to it"); the tests were not moved and no split proposal is recorded anywhere a PR
  description would pick it up. The deviation is disclosed only in evidence.md. A checked box that does not match what
  was implemented fails "All task items marked done and matching what was implemented". See CR 1.

### Phase 2: Code Review — FAIL

Logic of `PipelineRunDeletedRecovery` is correct and narrow: recovery requires `won = true` AND privileged
`findByIdInternal` = None; D1b re-fails non-`RunNoLongerOpen` failures as `RunNoLongerOpen(Missing)` only when
`won = false` and the pipeline is gone; every other combination (live pipeline, `updateRun` failed, lookup failed)
propagates the original. The settle cannot deadlock (no sibling depends on the recovery). No `PipelineRunExecutor`
change needed. Gates green (above). Issues:

- **[mechanical] Inline fully-qualified names** — CONTRIBUTING.md "Imports & Qualifiers" (line 70: "never inline a
  fully-qualified name when an `import` would do"). `scala.util.Success(...)` is inlined at
  `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala:325`, `:344`, `:378`, while the same
  file already imports `scala.util.Try` at :34. (Not caught by `check-scala-quality.mjs` because `scala.util.` is not in
  its prefix list; the written rule still applies.) See CR 2.
- **Stale comment (now false)** — `LateFinisherRunSpec.scala:295`: section divider reads "the outcome then depends on
  where the delete lands", which is exactly what HEL-1564 removes; under the new rule the outcome no longer depends on
  it. See CR 3.
- **Stale comment (now false)** — `PipelineRunSucceededWrites.scala:295-296`: "Edge: `for` fails fast, so if
  `materializedWrites` fails the event can fire while the eagerly-started `updateRun` is still in flight". Every
  failed chain now passes through `PipelineRunDeletedRecovery.recover`, which settles the siblings and awaits `won`
  (= `updateRun`) before re-failing, so the event can no longer fire with `updateRun` in flight. See CR 3.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed (the spec delta is under
`openspec/changes/`). Dev servers not started.

### Overall: FAIL

The behaviour, proof and gates are sound; all failing items are small, mechanical fixes to test imports, two
comments and the task/plan record.

### Change Requests

1. `openspec/changes/late-delete-after-won-succeeds/tasks.md` task 1.3a: either (a) do what the task and design.md
   D5 say (move the HEL-1564 tests into a sibling spec sharing a fixture trait), or (b) leave the tests in place but
   make the record truthful: annotate 1.3a as a deviation (tests not moved: the fixture seams are private to the spec;
   extraction deferred), add the same note to design.md D5's "Test-file budget" line, and record in `files-modified.md`
   a split proposal for `LateFinisherRunSpec.scala` (now 499 lines) for the PR description, which is the remedy
   CONTRIBUTING.md:24 names for a file crossing ~400 lines.
2. `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala:34`: change `import scala.util.Try` to
   `import scala.util.{Success, Try}`, and replace `scala.util.Success(` with `Success(` at :325, :344 and :378.
3. Fix two comments that the change made false:
   - `LateFinisherRunSpec.scala:295`: reword the divider so it no longer says the outcome depends on where the delete
     lands (e.g. "The run's own terminal write COMMITS FIRST (HEL-1544/HEL-1564): a later delete answers success
     wherever it lands").
   - `PipelineRunSucceededWrites.scala:295-296`: remove or rewrite the "Edge: ... `updateRun` is still in flight"
     sentence; since HEL-1564 a failed chain settles its siblings and awaits `updateRun` in
     `PipelineRunDeletedRecovery.recover` before it fails, so `succeeded` (on the still-published non-guard failure
     path) fires only after `updateRun` settled.

### Non-blocking Suggestions

- D2 ("settle before answering") is not pinned by any test: mutation 5 above (drop `settle(siblings)`) leaves the spec
  16/16 green. Its observable effect is small (the skipped sibling writes are no-ops on a deleted pipeline), so a test
  is optional. If kept untested, add one line to evidence.md saying so, so nobody later reads D2 as proven.
- `PipelineRunSucceededWrites.scala:309`: the edited scaladoc line is ~170 characters, much wider than the
  surrounding lines; rewrap it.
- `PipelineRunDeletedRecovery.recover` takes five positional parameters including two `Future`s. Named arguments at
  the call site (`PipelineRunSucceededWrites.scala:288-290`) would make `chain` vs `won` impossible to swap unnoticed.
