## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `56826a4f9f483871fe6a3fc5d28d475536a11911`. Base resolved live with `resolve-review-base.sh`: `941f18817`.
The only code change is `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala` (+18/-1). No production code changed. No UI.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/latefinisher-spec-ci-flake/hel-1544`.
- **Production mechanism (read the code myself):** in `PipelineRunSucceededWrites.scala`, `writesChain` builds `materializedWrites` (line 85, which calls `outputRepo.listByPipelineInternal`) and `updateRun` (line 240, the run's own `succeeded` terminal write) as eager `val`s. The `for` at lines 276-285 orders only their results. So the spec's `beforeOutputList` delete races the terminal UPDATE. `failIfLostTerminalWrite` (lines 304-309) is a no-op when `won`. This matches design.md D1.
- **Spec run on HEAD:** `nice -n 19 sbt "testOnly ...LateFinisherRunSpec"` gave `Tests: succeeded 11, failed 0`.
- **Root cause reproduced deterministically (AC1).** I added temporary probe tests, ran them in one run, and reverted them with `git checkout`:
  - `PROBE unfixedA` (unfixed D7 body; the hook waits on `terminalWritten`, then deletes): **FAILED** with `Right(RunResultResponse(Vector(...3 rows...), 3, ...)) was not equal to Left(NotFound("Pipeline not found: ..."))`. This is the exact CI signature.
  - `PROBE unfixedB` (unfixed body, delete delayed 1500 ms): **FAILED**, same signature.
  - `PROBE fixedB` (the committed fix, plus the same 1500 ms delay before the delete): **passed**. The fix sequences the two writes; it does not depend on timing (AC3).
- **Mutation M6 (AC4):** I changed `failIfLostTerminalWrite`'s guard to `if (true) Future.unit`. Result: `succeeded 9, failed 2`. The fixed D7 delete test went red with `Right(...)`, and the D7 reap test went red too. Reverting with `git checkout` restored the tree. The fixed test still guards D7.
- **Classification (AC2):** I read the archived HEL-1518 `design.md` D7. It specifies only the lost-write path ("first terminal write wins: the late finisher lost"). In the CI interleaving the run's own write commits first, so the run is not a late finisher. "Test-only" is a defensible reading of D7, but see CR1 for where the artifacts over-generalize it.
- **H2 / sibling audit (AC5):** a reap can only produce `Conflict`, never `Right`, so H2 cannot cause this signature. The item-1 tests act before the success chain starts. My item-2 probe (below) confirms that test answers 404 in either order, so it is not exposed.
- **AC6:** evidence.md reports 10 runs under 3 busy loops, with every run at 11/0. It honestly notes that `HEL924_TEST_GROUP_CONCURRENCY=2` has no effect on a single-spec `testOnly`. Because the fix is order-based, not time-based, and `PROBE fixedB` passes with a 1500 ms adverse delay, I accept this.
- **Tree state:** I reverted all probe and mutation edits. `git status --short` shows only the evaluator's untracked `evaluation-1.md`.

### Verdict: REFUTE

The fix itself is correct, sequences rather than times, is non-vacuous, and is probe-confirmed. The refutation is narrow. The new positive-pin test, and the evidence reasoning behind it, state a general guarantee that production does not provide. The orchestrator asked about exactly this.

### Change Requests

1. **The positive pin's name claims more than production guarantees.** The test is at `LateFinisherRunSpec.scala:222`: "answer success and publish succeeded when its own terminal write committed before the pipeline was deleted (first terminal write wins)". My probe `PROBE item2D` did the following: let the run's own terminal write commit (wait on `terminalWritten`), then delete the pipeline in `beforeNodeFold`, after the Output list was read. Result:

   `res=Left(NotFound(Pipeline not found: ...)) events=Vector(queued, running, node-progress, node-progress)`

   So the run's write committed first, the run won, and it still got **404 with no `succeeded`** (the D3 node guard sees the run Missing). Production answers success only when the delete *also* lands before the Output list is read. Please do all of the following:
   - (a) Rename the test so its title states the actual precondition. Example: "...when its own terminal write committed before a pipeline delete that landed before the Output list was read". Drop the bare "(first terminal write wins)" attribution, or qualify it.
   - (b) Move the test out of the describe block "a run whose terminal write **loses** after the node fold (HEL-1518 D7)" (line 207). In this test the run's write wins.
   - (c) Optionally, pin the asymmetry as well. For example, a sibling assertion for the item-2 window, where a won-then-deleted run gets 404, so a future change to either window is a deliberate decision.
2. **Correct the reasoning in evidence.md §1.3 and §2.3.** "That is the correct linearization under HEL-1518 D7 ('first terminal write wins')" and "it documents why the flake was a `Right`" present D7 as a general success guarantee for a won run. The item-2 result above shows the outcome for a won-then-deleted run depends on where the delete lands relative to the Output list read. State that the `Right` follows from the empty Output list meaning no node guard runs, so `won=true` decides, and record the item-2 asymmetry. The test-only classification still holds: D7 defines only the lost path, and HEL-1518 never promised a 404 for a run that already won. But the stated reasoning must not over-claim.

### Non-blocking notes

- The pin's positive `eventsOf(fx) should contain("succeeded")` relies on the existing 300 ms settle in `eventsOf` (line 153). The healthy-run control (line 269) already uses the same pattern, but a positive assertion against a fixed settle window could itself flake under CI load. Consider polling until the event arrives or a deadline passes.
- The run-to-run inconsistency (Right vs 404 for a run that won and was then deleted) is product behavior that predates this change and is not in this ticket's scope. If the owner wants one consistent answer, it should be a follow-up ticket.
