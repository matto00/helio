## Context

See proposal.md for why. Ground truth (main 941f18817):

- `PipelineRunSucceededWrites.onUnblockedRunSuccess.writesChain` builds `materializedWrites` (which calls
  `outputRepo.listByPipelineInternal`) and then `updateRun` (the run's own `succeeded` terminal write) as eager `val`s.
  Both are in flight at once; the `for` only orders their *results*. `failIfLostTerminalWrite` turns a lost terminal
  write into `RunNoLongerOpen` (404/409); a WON terminal write is a normal success (HEL-1518 design.md D7: "first
  terminal write wins").
- The spec's `GatedRunRepo` exists exactly to hold that eager write back (`terminalGate`, comment at spec line ~76).
  The item-2 reap test and the D7 reap test set it; the D7 delete test (line ~205) and the item-2 delete test
  (line ~194) do NOT. The D7 delete test's hook (`beforeOutputList = () => deletePipeline(fx)`) therefore races the
  pipeline DELETE (cascading the run row) against the run's own `UPDATE ... succeeded`.

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause; the race removed from the spec by sequencing, not timing; red-then-green and
mutation evidence. **Non-goals:** see proposal.md; no change to production code unless the probe proves a production
defect, and in that case escalate before changing it.

## Decisions

**D1. Leading hypothesis H1 (to confirm or refute by probe, not assume).** Under CI load the eager terminal write
commits before the hook's DELETE. The run is then `succeeded` (won = true), the DELETE cascades it away afterwards, the
Output list reads empty, nothing is written, `failIfLostTerminalWrite` is a no-op, and the result is
`Right(RunResultResponse(3 rows))` -- exactly the CI failure. Locally the DELETE, dispatched first, usually wins.
If H1 holds, the product behavior is correct (that linearization is "the run succeeded, then the pipeline was deleted")
and the defect is the test: it claims to exercise "deleted before the Output list was read" but does not sequence it.

**D2. Deterministic reproduction (the probe).** Force each order instead of hoping for it:
- Red probe A: delay the hook's delete until the terminal write has committed (e.g. a `terminalCommitted` promise
  completed by `GatedRunRepo` after `super.updateRunTerminal` returns, awaited by the hook before `deletePipeline`).
  The unfixed D7 test must fail with the CI signature `Right(RunResultResponse(...))`.
- Red probe B (the same probe the fix must survive): delay the delete itself (a `Future` delay before
  `deletePipeline` inside the hook) and run the unfixed test: must be red. A delay is legitimate in a probe; it is never
  the fix.
Record probe code (as a diff or snippet), command, and output in `evidence.md`. If neither probe reproduces the
`Right`, H1 is refuted: stop, record it, and investigate H2 (below) before changing anything.

**D3. Fix: sequence with the existing gate, not with time.** In the D7 delete test, hold `terminalGate` on a promise
completed when the hook's delete completes (success OR failure, so a failed delete fails the test instead of hanging),
mirroring the item-2 reap test's existing pattern. The delete now always lands before the run's own terminal write,
which is what the test name asserts. Alternatives rejected: retry/`eventually` (masks), sleep (timing), moving the
hook (changes what is exercised), changing production ordering (the eager write is intentional, HEL-1366/HEL-1518).

**D4. Audit siblings (AC5).** Apply D2's probe B to every test whose hook deletes or reaps while `terminalGate` is
open -- at minimum the item-2 "deleted in that window" test (line ~194). Fix any that goes red the same way (D3). For
any that stays green, record why (e.g. the node guard sees the run row Missing either way) in `evidence.md`. The item-1
tests act before the early open-check, so the terminal write has not started; confirm by reading, cite lines.

**D5. Optional positive pin (executor's call, record the decision).** Probe A can become a permanent test pinning the
other linearization: a terminal write that commits before the delete answers `Right` and publishes `succeeded`
(D7's "first terminal write wins"). Add it only if it is cheap and deterministic; it documents why the flake was a
`Right`.

**D6. H2 / HEL-1558's interleaved WARNs.** `reapStaleRunsInternal` is global (now + 2 h reaps every open run in the
DB). Determine whether another spec's reap (or this spec's) can touch this spec's run under
`HEL924_TEST_GROUP_CONCURRENCY=2` (separate DB per group or shared?). Note a reap of this run yields `Conflict`, never
`Right`, so H2 cannot by itself produce the observed signature; state the finding and cite the harness code.

## Risks / Trade-offs

- [Gate never completes, test hangs] -> complete the promise on delete failure too; `submit` already awaits with a
  bounded `awaitDb`.
- [Fix makes the test vacuous] -> mutation M6 (`failIfLostTerminalWrite` -> `Future.unit`) must still turn the fixed
  test red; record it.
- [H1 wrong] -> D2 makes this explicit: no fix lands without a reproducing probe.

## Planner Notes

- Self-approved: test-only scope, `skip_specs: true`, no escalation (no product decision unless D2 refutes H1 or
  shows a production defect -- then the executor escalates).
- Whole-backend runs exceed 600 s; this change needs only `testOnly com.helio.services.pipelines.LateFinisherRunSpec`
  plus the repeat runs in tasks.md, all foreground.
