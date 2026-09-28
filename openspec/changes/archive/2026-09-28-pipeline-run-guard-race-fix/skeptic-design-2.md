## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in full (current state, not a
  diff), plus round 1's report (`skeptic-design-1.md`) for the required revisions to check.
- **Round-1 required revision — reconciliation with the pre-existing test — verified as
  correctly and accurately addressed, against ground truth, not the executor's summary:**
  - `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/
    PipelineRunRepositorySpec.scala:639-660` — read the actual lines. The cited range exactly
    brackets the HEL-505 comment block + the full `"concurrent submissions for the same owner
    never exceed the concurrency cap"` test body (confirmed via `grep -n` for the test name and
    its assertions, and a direct `sed -n '639,662p'` read). Matches design.md's Decision 1
    description precisely: 12 concurrent `Future.sequence` calls to
    `insertRunIfUnderConcurrencyCap`, asserting exactly `maxConcurrent` `Inserted` and the rest
    `CapExceeded`.
  - Git-history claim checked directly: `git log --oneline --follow` on that spec file and
    `git log -p --follow | grep` for the test's introduction show it was added in a single
    commit (`29a47220` on `main`, matching `2cc73b4e` in the full ref-log — same HEL-505 PR
    #688) with no subsequent commit touching it. This matches design.md's claim ("a single
    commit ... with no subsequent fix").
  - Decision 1 (Step 0), Decision 3's H1 branch, and task 1.0/2.2 now all correctly state the
    existing test is cited as guard-atomicity proof (not duplicated), rescoping task 2.2 from
    "add" to "verify + cite," exactly as round 1 required — and go further than the minimum by
    adding an explicit self-check ("confirm the log shows genuinely overlapping lock-acquire
    attempts, not serialized ones, before relying on it") rather than asserting sufficiency
    from inspection alone, consistent with the ticket's own `systematic-debugging` standard.
  - `proposal.md`'s Impact section now correctly lists `PipelineRunRepositorySpec.scala:639-660`
    as "read/cited, not modified" and scopes `PipelineRunGuardIntegrationSpec.scala` as the
    "test-only H1 coordination fix" location. Matches round 1's third required bullet.
  - Non-blocking note (test-only route, no production seam) is now committed explicitly:
    Decision 3's H1 branch states "zero production `PipelineRunService`/`PipelineRunRepository`
    changes needed" and cites `PipelineRunService.executeRun` lines 1003-1029 as the ground
    truth for why. I re-read `backend/src/main/scala/com/helio/services/pipelines/
    PipelineRunService.scala:995-1029` directly: the concurrency-cap decision (`preExec`,
    including `deleteOldRuns`) does fully resolve via `.flatMap` chaining before
    `preExec.flatMap` (which leads to `backend.execute`) — the citation is accurate.
- Confirmed no new placeholders/TBDs, no new internal contradiction between
  proposal/design/tasks, no scope drift, and `skip_specs: true` remains justified (unchanged
  contract, only its enforcement/observation is in question).

### New issue found in the revision itself

Round 1's version of task 2.2 was "add" a new guard-level test, which task 2.4 ("demonstrate
the new interleaving test(s) from 2.2/2.3 are failable by mutation") would have automatically
covered. The revision correctly rescoped 2.2 to "verify + cite" the pre-existing
`PipelineRunRepositorySpec` test instead of adding a new one — but in doing so, it silently
dropped that test out from under the mutation-kill requirement:

- `design.md` Decision 4: "**Whichever deterministic interleaving test is added**, demonstrate
  it is failable by mutation ... show the **new** test goes red."
- `tasks.md` 2.4: "Demonstrate the **new** interleaving test(s) from 2.2/2.3 are failable by
  mutation."

Both are worded exclusively around a test that gets **added**. Under the H1 "verify + cite"
branch (the branch the design's own Decision 2 reading currently leans toward as more likely),
no new test is added — so, read literally, task 2.4 does not apply to the H1 path at all, and
the fix could ship backed only by a pre-existing test that has never been demonstrated to
actually catch the defect class it's being relied on to rule out. Confirming the test "still
passes" and "has never failed" (task 1.0) is a true-positive check, not a true-negative one —
it is exactly the "appears to, on inspection" confidence level that Decision 1's own language
says `.concertino/laws/systematic-debugging` prohibits acting on, now reapplied one layer
removed to the cited test's adequacy rather than to the guard's code. The ticket's own standing
constraint is unconditional and not scoped to newly-written tests: "A guard test must be
failable by mutation — show the mutation" (`ticket.md:50`).

### Verdict: REFUTE

### Change Requests

1. **Extend the mutation-kill requirement to the cited pre-existing test under the H1
   "verify + cite" branch, not just to a newly-added test.**
   - In `design.md` Decision 4, add a sentence covering the H1 "verify + cite" outcome
     explicitly: when task 2.2 concludes no new guard-level test is needed, the EXISTING
     `PipelineRunRepositorySpec.scala:639-660` test must itself be shown failable by mutation
     (e.g., temporarily drop the `pg_advisory_xact_lock` acquisition in
     `insertRunIfUnderConcurrencyCap`, or widen `maxConcurrent` by one at its call site) before
     it is relied upon as sufficient proof — then revert the mutation before commit, same as
     any other guard test.
   - In `tasks.md`, either broaden task 2.4's wording from "the **new** interleaving test(s)
     from 2.2/2.3" to explicitly include "or the cited existing test if 2.2 concludes no new
     test is needed," or add a new sub-task (e.g. 2.2a) under the H1 branch that performs this
     mutation-kill check specifically against `PipelineRunRepositorySpec.scala:639-660` before
     task 2.2 is considered complete.
   - This closes the gap the revision itself opened: rescoping 2.2 from "add" to "verify + cite"
     (correctly, per round 1) had the side effect of removing the only test that would have
     otherwise been mechanically covered by the mutation-kill task.

### Non-blocking notes

- The round-1 required revisions were each independently reproducible against ground truth
  (exact line ranges, exact git commit hashes, exact code structure) — no fabricated citations
  found in this round's edits.
- Decision 2's "static reading suggests H1" framing continues to correctly defer the actual
  branch decision to the probe (task 1.3), not to this reading — no premature conclusion baked
  into the task list.
