## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `9bd3cd453fe5f9e718c1bd5bb2bab570d5e6b12b`. I resolved the base live with `resolve-review-base.sh`, which returned `941f18817`. The only code change is to `backend/src/test/scala/com/helio/services/pipelines/LateFinisherRunSpec.scala`. No production code changed and there is no UI change, so step 4 does not apply.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/latefinisher-spec-ci-flake/hel-1544`.
- **Production mechanism (I read the code):** in `PipelineRunSucceededWrites.scala`, `materializedWrites` (which calls `listByPipelineInternal`) and `updateRun` (`writeTerminal ... "succeeded"`) are both eager `val`s. The `for` only orders their *results*. `failIfLostTerminalWrite` is a no-op when `won`. The node `guard` is `runGuardAction`. This confirms that the spec's `beforeOutputList` delete races the run's own terminal UPDATE.
- **Spec at HEAD:** I ran it twice with `nice -n 19 sbt -J-Xmx3g "testOnly ...LateFinisherRunSpec"`. Both runs gave `Tests: succeeded 12, failed 0`. All 12 test names are listed in the output, including the new describe block "a run whose own succeeded terminal write committed before its pipeline was deleted (HEL-1544)".
- **AC1 (root cause probe-confirmed):** I added a temporary probe test and later reverted it with `git checkout`. The probe used the unfixed D7 hook, but waited on `terminalWritten` before deleting. Result: `*** FAILED *** Right(RunResultResponse(Vector({"label":"a",...},{"label":"b",...},{"label":"c",...}), 3, ...)) was not equal to Left(NotFound("Pipeline not found: ..."))`. That is the exact CI signature.
- **AC3 (sequencing, not timing):** a second temporary probe used the committed fix plus a 1500 ms adverse delay before the delete. It **passed**: 404, nothing written, and no `succeeded`. The committed fix gates the run's own terminal write on a promise that completes when the delete finishes (`andThen`, so success or failure). There is no retry or sleep in the committed code. The only polls are bounded wait-for-condition loops: the pre-existing reap/healthy waits and the new 15 s `awaitSucceeded`.
- **AC4 (D7 non-vacuous), mutation M6:** I made `failIfLostTerminalWrite` always a no-op (`if (true || won || ...)`) and reverted it afterwards. Result: `succeeded 10, failed 2`. The fixed D7 delete test failed, and so did the D7 reap test.
- **AC2 (classification):** the run's own write commits first, so `won=true`. The Output list is empty after the cascade, so no node guard runs, and the D7 lost-write path never applies. "Test-only" is the right call. evidence.md §1.3 now says explicitly that this is *not* a general won-run success guarantee and records the item-2 asymmetry. That resolves round-1 CR2.
- **New pin 1 (success when the delete lands before the list read):**
  - Mutation M8 removed `won ||` from the guard, so a won-then-Missing run fails. Result: the pin failed (`false was not equal to true`, LateFinisherRunSpec.scala:258), and so did the healthy control. So pin 1 is non-vacuous.
  - Its name now states the actual precondition. It sits in its own describe block, not under "terminal write loses". This resolves round-1 CR1a/b.
  - It is deterministic. The hook waits on `terminalWritten`, so the delete is forced to land after the run's own write. Nothing deadlocks, because `updateRun` is constructed after the hook's future is created and is not gated. The positive `succeeded` check now polls up to 15 s, which addresses my round-1 non-blocking note.
- **New pin 2 (404 when the delete lands after the list read):**
  - Mutation: I removed the node guard (`guard = None`) and reverted it afterwards. Result: pin 2 failed, together with both existing item-2 tests (`succeeded 9, failed 3`). So pin 2 really depends on "a node guard sees the run Missing", which is what its title claims. This resolves round-1 CR1c.
  - It is deterministic. The delete in `beforeNodeFold` waits on `terminalWritten`.
- **Cross-test leakage of `terminalWritten`:** `GatedRunRepo` reads the `@volatile` var when the callback fires, not when the call is made. A terminal write from an earlier test that finishes late could therefore complete a later test's promise. I checked the tests that run before the pins:
  - The D7 reap test awaits `updateRun` through the `for`, and `andThen` fires before the chained future completes.
  - Pin 1 returns `Right` only after the whole chain.
  - The tests whose `updateRun` can outlive `submit` (item-2 reap/delete, where `materializedWrites` fails fast) are followed by tests that never read `terminalWritten`.
  - The pins capture `terminalWritten` into a local `val written` before submitting.
  - So I found no exposure in the current declaration order. See the non-blocking note.
- **AC5 (sibling audit):** evidence §2.2 is consistent with the code and with my mutation runs. Item-1 hooks fire before the success chain starts. The item-2 delete test answers 404 in either order (pin 2 now pins that exact case). The reap tests already use `terminalGate`.
- **AC6 (repeat under load):** I ran the spec 3 more times in a row with 3 `nice -n 19` busy loops and `HEL924_TEST_GROUP_CONCURRENCY=2` set. All 3 gave `succeeded 12, failed 0`. evidence.md notes that this variable has no effect on a single-spec `testOnly`. I accept that because the fix is order-based and stays green with the 1500 ms adverse delay.
- **Tree state:** I reverted every probe and mutation with `git checkout`. `git status --short` shows only the untracked `evaluation-1.md` and `skeptic-final-1.md` (and this report).

### Verdict: CONFIRM

### Non-blocking notes

- `files-modified.md` still describes the spec change as "add first-terminal-write-wins positive pin". Round 1 asked for that wording to be dropped in the test itself. The description is now stale: it is two qualified pins.
- design.md D5 still frames the optional pin as "D7's 'first terminal write wins' ... documents why the flake was a `Right`". It is a pre-implementation plan, and evidence.md (the record) now carries the corrected reasoning. Consider aligning design.md before archive.
- `terminalWritten` is completed via a mutable var read when the callback fires, so a terminal write that outlives its own test could complete a later test's promise. That is not exposed in the current order (analysis above). Capturing the promise when `updateRunTerminal` is called (`val signal = terminalWritten` next to `val gate = terminalGate`) would close it structurally.
- As noted in round 1, it is still pre-existing product behavior that a won-then-deleted run can answer either `Right` or 404 depending on where the delete lands. The pins now make that behavior explicit. A follow-up is the owner's call.
