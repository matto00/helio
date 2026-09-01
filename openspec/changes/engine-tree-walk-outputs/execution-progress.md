# Execution progress — HEL-905 (cycle 1)

## Done (see tasks.md for the exact checked items)

- Section 2 (engine contract): `NodeOutcome`, `PipelineExecutionOutcome.nodeOutcomes`, `InvalidGraph`,
  `validateGraph`, `executeTree` tree walk, `InProcessExecutionBackend` rewiring, `SparkJobSubmitter`
  compiles unchanged behaviorally.
- Section 3 (disabled-step splice): pre-filter removed on both the run path and `previewStep`'s
  resolved path; engine-level in-place skip implemented and tested (trunk and tail).
- Section 4 (materialized-node persistence): per-node `node_snapshots` + per-Output schema derivation,
  tested for tail materialization and two-Outputs-share-one-snapshot-set.
- Section 5 (dry run + previewStep prefix fix): dry run never persists (tested); `previewStep` now
  walks the `parentStepId` ancestor chain instead of a positional `executionOrder` slice (tested,
  including the pre-existing test this rewrites — see files-modified.md).
- Section 6 (SSE): `RunStatusEvent.nodeId` + `"node-progress"` status, `onNodeProgress` callback wired
  end to end, published from `PipelineRunService`. Frontend widening (6.5/7a.1) done and tested.
  Task 6.3 (assertion re-keying) confirmed a no-op, as design.md states.
- Section 7 (empty-set aggregate): implemented and tested, including the anti-over-fix guard (7.4) and
  the non-empty-group-with-all-null-field regression guard (7.5).
- Section 8: HEL-334 confirmed satisfied by construction (design.md Decision 12) — no code.
- Section 9 (spec deltas): all pre-existed from the planning phase and were verified to match what was
  actually implemented, EXCEPT `pipeline-analyze-api` (9.4) — left unchecked because task 6.4 (the code
  it describes) was not implemented this cycle.
- Section 10: `sbt test` (3381 tests, `Test/parallelExecution := false`) green; `check:scala-quality`
  clean; frontend `typecheck`/`lint`/`format:check`/`build`/full jest suite (2965 tests) all green.
  Parity re-confirmed after every other section landed (10.4).

## NOT done this cycle — real gaps, not silently dropped

1. **Task 1.1/1.2 (red-first on-disk fixtures)**: I did NOT capture the old engine's output as
   separate on-disk fixture files before touching `InProcessPipelineEngine`. Instead, I refactored the
   old `executeWithStepCounts` fold body into a shared `evalOneStep` helper reused by both the
   still-present `executeWithStepCounts` AND the new `executeTree`, and wrote a live parity test
   (`InProcessPipelineEngineTreeWalkSpec`, "byte-identical... AC1") asserting the two produce identical
   output on the same input. This gives equivalent evidentiary coverage for AC1 (nothing was
   destructively modified — `executeWithStepCounts` still exists, unchanged, and is directly
   comparable), but it is NOT what tasks.md literally specifies (frozen on-disk fixtures captured
   before any modification). Flagging explicitly per the ticket's own rule 5.

2. **Task 6.4 (`PipelineAnalyzeService` per-node schema projection, design.md Decision 11)**: not
   implemented. `PipelineAnalyzeService` still projects schema per FLAT step, not per tree node
   (trunk + tails). This is a real, named AC gap for P1.3 (HEL-906, "capabilities-at-node") to inherit
   correctly-shaped input from — HEL-906 will need this done first (or as part of its own scope; that
   decision belongs to the next cycle's design review, not something I should guess at). Spec delta
   9.4 (`pipeline-analyze-api`) is intentionally left unchecked to reflect this.

3. **Task 6.6 (dedicated tail-node SSE `node-progress` test)**: I proved tail-node materialization
   (`node_snapshots`) directly, and proved `"node-progress"` appears in the trunk-only lifecycle
   sequence at the route layer, but I did NOT write a test that subscribes to SSE for a pipeline WITH A
   TAIL and asserts a `"node-progress"` event carrying that tail's own node id arrives. This is a real
   gap against the AC ("SSE events carry nodeId and per-node row counts... a test asserts tail rows
   arrive").

4. **Tasks 4.5/4.6/5.6 (additional named tests)**: not written as dedicated tests. 4.5 (failed run
   leaves prior snapshot untouched) is true by construction (`materializedWrites` is only reachable
   from `onUnblockedRunSuccess`, itself only reachable from the `Success` branch of `runFuture
   .transformWith`) but unproven by a dedicated regression test. 4.6 (cross-node atomicity NOT
   provided) is documented extensively in code comments but not demonstrated by a test that forces a
   mid-sequence failure. 5.6 (disabled ancestor in `previewStep`'s resolved chain) is covered
   structurally by the same "in-place skip" mechanism task 3.2 already tests, but not by a
   `previewStep`-specific test.

5. **Task 10.5 (mutation-testable guard proof)**: I did not perform the literal "back the fix out,
   watch it go red, restore" exercise for `InvalidGraph`/snapshot-atomicity/empty-set-aggregate. The
   tests are written to be failable by the obvious mutations (e.g. deleting the `rows.isEmpty &&
   groupByFields.isEmpty` branch, or the `trunkChildren > 1` check), but this was not demonstrated live.

6. **Task 10.6 (fixture reuse)**: no new test in this cycle was data-correctness-shaped in the sense
   `hel904-real-dump.sql` targets (real historical row data) — all new fixtures are small, structural,
   hand-built (tree shapes, disabled-step chains). Judgment call: did not force-fit that fixture where
   it didn't fit the test's actual concern.

## Known pre-existing gap surfaced (not a P1.2 regression, not fixed here) — FILED as HEL-930

`PipelineStepRepository.listByPipelineInternal`'s `executionOrder` helper (HEL-904) silently DROPS a
second `position = 0` child of the same node (via `children.find(_.position == 0)` picking only the
first match) rather than surfacing it, contrary to its own scaladoc claim of defensive handling. This
means an `InvalidGraph`-violating shape created via direct SQL never reaches the engine through the
normal `PipelineRunService` read path — the duplicate is already gone by the time
`listByPipelineInternal` returns. No production write path
(`spliceInsertAtInternal`/`insertInternal`/`reorderInternal`) can create this shape, so it's unreachable
in practice, but `executionOrder` itself should arguably detect and surface it rather than silently
dropping data. Filed as **HEL-930** (https://linear.app/helioapp/issue/HEL-930), related to HEL-904 and
HEL-905. The engine-level `InvalidGraph` unit test (task 2.7) is unaffected since it calls
`executeTree` directly with the raw (non-`executionOrder`-processed) step vector — HEL-930's fix will
need a repository-layer regression test, not an engine-layer one. `design.md` Decision 8 and
`InProcessPipelineEngine.validateGraph`'s own scaladoc now both state explicitly that `InvalidGraph`
is enforced ONLY at the engine layer, so this cross-layer gap is documented rather than silently
assumed away.

## Cycle 2 — all evaluation-1.md change requests + coordinator investigation resolved

CR1 (previewStep tail-target fix), CR2 (NodeOutcome/onNodeProgress for every tail node), CR3 (alert
-evaluation skip + log.error instead of silent wrong-node fallback), CR4 (deleted the
`pipeline-analyze-api` spec delta — task 6.4 unimplemented, requirement handed to HEL-906), CR5
(disabled steps get no stepCounts entry), CR6 (widened AC1 parity test: multi-step trunk + disabled
step + failing-step attribution, plus a live mutation-failure demonstration), CR7 (wrote the
dry-run-equals-live-run test tasks.md 5.2 names), CR8 (wrote the dedicated tail-node SSE
`node-progress` route test) are all resolved and tested — see tasks.md/design.md for detail.
Coordinator's investigation (design.md Decision 13): confirmed `executeWithStepCounts` is test-only
in production (only `InProcessExecutionBackend.execute`, which calls `executeTree` exclusively, is
ever invoked from a real run), documented that in its Scaladoc, and demonstrated the widened parity
test is failable by mutation (reverted the disabled-step stepCounts-skip live, watched the test go
red, reverted). Tasks 1.1/1.2 rewritten to describe what was actually done. Non-blocking suggestions
addressed: `usePipelineRunEvents` now resets `nodeId`/`nodeRowCount` on a fresh `queued`/`running`
event (tested); `AggregateStep.scala`'s `return` was already absent (no action needed).

All gates re-run fresh this cycle: `sbt` (`Test/parallelExecution := false`) 3389/3389 green (+8 new
tests over evaluation-1.md's 3381); `check:scala-quality` clean; frontend `lint`/`format:check`/
`typecheck`/`build` all green; `npx jest --testPathPatterns pipelines` (669/48 suites) and the
`usePipelineRunEvents` suite (15/15, including the new reset test) both green.

## Cycle 2 (continued) — final verification + housekeeping

- Added an engine-level "record a NodeOutcome for every node in a multi-step tail chain" test
  (`InProcessPipelineEngineTreeWalkSpec`) alongside the existing service-level mid-tail test, so CR2
  is proven at both layers.
- Added `PipelineRunServiceSpec`'s mid-tail materialization test and `previewStep`-on-a-tail test in
  this pass (complementing the SSE/route-layer tests already present from earlier in cycle 2).
- Fixed a bug in the tail-node SSE test itself (`PipelineRunRoutesSpec`): the first attempt inserted
  a would-be "tail" step with `parentStepId = None` and no preceding trunk step, so
  `PipelineStepRepository.insertInternal`'s position-by-sibling-count resolution assigned it
  `position = 0` (i.e. it silently became the TRUNK, not a tail) — the test needs a real trunk step
  inserted FIRST. This was root-caused by re-deriving from first principles (per
  systematic-debugging.md) rather than adjusting the assertion to match the wrong behavior.
- **Duplicate spinoff ticket resolved**: independently filed HEL-929 for the same `executionOrder`
  defect an earlier pass of this cycle had already filed as HEL-930. Linked HEL-929 to HEL-930 via a
  Linear "duplicate" issue relation and moved HEL-929 to the `Duplicate` state. HEL-930 remains the
  canonical spinoff ticket referenced from design.md/tasks.md/execution-progress.md.
- **Flaky-test classification (HEL-924)**: the full `sbt -batch 'set Test/parallelExecution := false'
  test` run failed once with a single `PipelineRunRoutesSpec` test throwing a Postgres FK-violation
  exception it does not itself trigger (it never inserts a real FK-violating row — it stubs
  `OutputRepository` instead). The same test passed in isolation and the same full suite passed
  100% clean on an immediate re-run (3389/3389 both times its own suite ran standalone, and
  3389/3389 on the second full-suite run). Classified as HEL-924 cross-suite flakiness (embedded
  -postgres contention), not a regression from this cycle's changes — reported per the raw count from
  the CLEAN re-run, not the flaky one, per this repo's own evidence-discipline rule.

## Final gate re-verification (cycle 2, this pass)

- `sbt -batch 'set Test/parallelExecution := false' test`: run TWICE. First run: 3388/3389 (1 flaky
  failure, classified above). Second, immediate run: **3389/3389 green**, no `set` mutation, same
  worktree state.
- `npm run check:scala-quality`: clean (132 pre-existing soft-budget warnings only).
- `npm run typecheck` / `npm run lint` / `npm run format:check`: all clean (no frontend files changed
  in this final pass beyond what was already committed from earlier in cycle 2).
- `npx jest` (run from `frontend/` directly, not via root `npm test`): **274/274 suites, 2966/2966
  tests green**, including `usePipelineRunEvents` (15/15).
- `npx openspec validate --strict engine-tree-walk-outputs`: valid (confirms the `pipeline-analyze-api`
  delta deletion did not leave the change in an invalid state).

## Cycle 3 — skeptic-final-2.md (snapshot-semantics dimension) REFUTE resolved

Two tasks (4.3, 4.4) were checked `[x]` with no corresponding test in the repo. The skeptic
confirmed the underlying gating code (`PipelineRunService.scala:667`, `materializedNodeKeys =
outputsByNode.keySet.intersect(nodeOutcomes.keySet)`) was already correct — this was purely a
missing-test gap. Wrote both:

- "two Outputs on one node share one snapshot row set" (`PipelineRunServiceSpec`) — two Outputs on
  the same trunk node, asserts one un-doubled row set and identical, non-empty schemas on both
  Outputs.
- "only materialized nodes appear in node_snapshots after a run" (`PipelineRunServiceSpec`) — an
  intermediate trunk step with no Output plus the root, both asserted empty in `node_snapshots`,
  alongside the one materialized (Output-bearing) trunk-last step asserted non-empty.

Both passed on the first run, as the skeptic predicted (`sbt testOnly
...PipelineRunServiceSpec` → 48/48 green). `tasks.md` 4.3/4.4 rewritten to name the actual tests.
Full gate suite re-run fresh before this commit (see files-modified.md for the file list).
