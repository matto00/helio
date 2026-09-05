# Mutation Evidence — HEL-957

All mutations below were applied to real source
(`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`), the affected
spec run with `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec -- -z HEL-957"`,
verbatim failure output captured, then the mutation was reverted before moving to the next one.
`git diff --stat -- backend/src/main` was empty for production source after every revert (checked
after each mutation; confirmed again at the end — see "Final state" below).

**Cycle 2 (evaluation-1.md CR1):** the first fixture's trunk was lengthened from a two-node chain
(`[stepA, target]`) to a three-node chain (`stepA -> stepB -> target`), keeping the off-closure
enabled tail attached to `stepA`. All M1/M2/M3-replacement transcripts below are FRESH runs
against this three-node fixture — the cycle-1 transcripts, captured against the two-node fixture,
no longer describe the shipped code and have been replaced, not merely appended to.

The three guard tests (`PipelineRunServiceSpec.scala`):

1. "GET preview's stepRowCounts key set observes exactly the target's dependency closure,
   excluding an off-closure sibling tail (HEL-957 AC1/AC2)" — three-node trunk
   (`stepA -> stepB -> target`) plus an off-closure enabled tail off `stepA`, guards line 507
   (`previewAtNode`/`previewStep`).
2. "GET preview's stepRowCounts key set excludes a sibling node on an entirely different root
   (HEL-957 AC3, M4 fixture axis)" — two-root fixture, same guard mechanism, a distinct FIXTURE
   axis (not a distinct code mutation) per design.md Decision 3's honest-accounting requirement.
3. "backfill's spy execution backend observes exactly the target's dependency closure, excluding
   an off-closure sibling tail (HEL-957 AC5)" — guards line 662
   (`evaluateNodeRowsForBackfill`/`backfillOutputNode`) via a spy `PipelineExecutionBackend` that
   captures the `steps` argument handed to `execute`, since the persisted output at that site is
   read through the same node-keyed lookup and is provably invariant under the widening mutation.

## M1 — Slice too wide (line 507: `closureOf(...)` -> `sortedSteps.toVector`)

Edit applied:
```scala
-                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target)
+                  val slicedSteps = sortedSteps.toVector // HEL-957 MUTATION M1 (cycle 2 re-run)
```
Command: `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec -- -z HEL-957"`

Result: RED, right reason (key-set mismatch, superset failure — the observed set GAINS the
off-closure id) — BOTH guard tests failed; the third (spy/site-2) test, unaffected by a
line-507 mutation, stayed green:

```
[info] - should GET preview's stepRowCounts key set observes exactly the target's dependency closure, excluding an off-closure sibling tail (HEL-957 AC1/AC2) *** FAILED ***
[info]   Set("2cf27b4f-8a1f-47b8-8e6c-69535c38fe0b", "8bb3af90-08bc-4836-bb18-65073645f5d3", "84998658-c90b-4b1a-bdb9-fa9712028b82", "c3d7ef80-d5b8-4a91-a254-cded6b96a645") was not equal to Set("2cf27b4f-8a1f-47b8-8e6c-69535c38fe0b", "84998658-c90b-4b1a-bdb9-fa9712028b82", "c3d7ef80-d5b8-4a91-a254-cded6b96a645") (PipelineRunServiceSpec.scala:1124)
[info] - should GET preview's stepRowCounts key set excludes a sibling node on an entirely different root (HEL-957 AC3, M4 fixture axis) *** FAILED ***
[info]   Set("7e10fa30-108e-4f91-b1e7-40626ba12f12", "1d0eaae5-1338-48fc-a429-06a0584d145e", "48cbf585-9651-43de-9768-ac346eefaf8b") was not equal to Set("7e10fa30-108e-4f91-b1e7-40626ba12f12", "1d0eaae5-1338-48fc-a429-06a0584d145e") (PipelineRunServiceSpec.scala:1151)
[info] Tests: succeeded 1, failed 2, canceled 0, ignored 0, pending 0
```
On the three-node fixture the expected set now has 3 members; M1's observed set has 4 (the extra
id is the off-closure tail). Full transcript: `m1_evidence.txt`. Reverted after capture.

## M2 — Wrong node targeted (line 507: `closureOf(sortedSteps.toVector, target)` -> `closureOf(sortedSteps.toVector, sortedSteps.head)`)

Edit applied:
```scala
-                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target)
+                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, sortedSteps.head) // HEL-957 MUTATION M2 (cycle 2 re-run)
```
Command: same as above.

Result: RED, right reason (key-set mismatch, subset failure — the observed set is `sortedSteps.head`'s
OWN closure, `{stepA}` alone, since `stepA` has no ancestors):

```
[info] - should GET preview's stepRowCounts key set observes exactly the target's dependency closure, excluding an off-closure sibling tail (HEL-957 AC1/AC2) *** FAILED ***
[info]   Set("61da75f3-4727-4450-8671-b028db5f2192") was not equal to Set("61da75f3-4727-4450-8671-b028db5f2192", "6e7cab12-857d-4ae1-9a5d-cb22a0ea2233", "f166ed00-8193-4dc9-828d-da81cdcbcda4") (PipelineRunServiceSpec.scala:1124)
[info] - should GET preview's stepRowCounts key set excludes a sibling node on an entirely different root (HEL-957 AC3, M4 fixture axis) *** FAILED ***
[info]   Set("ebd7c38d-ea70-4b11-a18f-9cffe34c9c4c") was not equal to Set("ebd7c38d-ea70-4b11-a18f-9cffe34c9c4c", "25751dd2-cb2a-40b7-a07f-b715a9637a25") (PipelineRunServiceSpec.scala:1151)
[info] Tests: succeeded 1, failed 2, canceled 0, ignored 0, pending 0
```
Observed key set on the three-node fixture: exactly 1 key (`{stepA}`). Full transcript:
`m2_evidence.txt`. Reverted after capture.

## M3 — Degenerate / off-by-one at the target end

### M3 attempt 1 (original form): `closureOf(...) -> Vector(target)` (self-only, ancestors dropped)

Edit applied:
```scala
-                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target)
+                  val slicedSteps = Vector(target) // HEL-957 MUTATION M3-original (cycle 2 re-run)
```

Result: **RED for the WRONG reason**, exactly as design.md Decision 3 predicted, and unchanged by
the trunk-length change (dropping ALL of target's ancestors — now two of them, `stepA`/`stepB` —
still leaves the engine unable to feed the target a frame; the whole call fails with a
500-shaped `UnprocessableEntity`, not a key-set mismatch):

```
[info] - should GET preview's stepRowCounts key set observes exactly the target's dependency closure, excluding an off-closure sibling tail (HEL-957 AC1/AC2) *** FAILED ***
[info]   Left(UnprocessableEntity("Pipeline execution failed")) was not an instance of scala.util.Right, but an instance of scala.util.Left (PipelineRunServiceSpec.scala:1119)
[info] - should GET preview's stepRowCounts key set excludes a sibling node on an entirely different root (HEL-957 AC3, M4 fixture axis) *** FAILED ***
[info]   Left(UnprocessableEntity("Pipeline execution failed")) was not an instance of scala.util.Right, but an instance of scala.util.Left (PipelineRunServiceSpec.scala:1150)
```
Full transcript: `m3_original_wrongreason_evidence.txt`. **This red does NOT count as an axis** —
per design.md Decision 3 / tasks.md 4.3, it is discarded and replaced by the pre-committed
substitute below. Reverted after capture.

### M3 replacement (pre-committed in design.md Decision 3): `closureOf(sortedSteps.toVector, target).dropRight(1)`

Edit applied:
```scala
-                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target)
+                  val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target).dropRight(1) // HEL-957 MUTATION M3-replacement (cycle 2 re-run)
```
Command: same as above.

Result: RED, right reason. On the three-node fixture the closure vector is
`[stepA, stepB, target]` in repository order, so `dropRight(1)` drops only the TERMINAL element
(`target`), leaving `[stepA, stepB]` — a valid, connected slice the engine can still execute — and
the resulting key set is missing only the target's own key:

```
[info] - should GET preview's stepRowCounts key set observes exactly the target's dependency closure, excluding an off-closure sibling tail (HEL-957 AC1/AC2) *** FAILED ***
[info]   Set("0ed546a1-f8b9-474c-9f9a-aa8074bc1140", "6df285ac-a41b-4f2d-a34a-1018cd9939bb") was not equal to Set("0ed546a1-f8b9-474c-9f9a-aa8074bc1140", "6df285ac-a41b-4f2d-a34a-1018cd9939bb", "ab3c06b5-8d70-4bca-bc4d-9f9b0288bd77") (PipelineRunServiceSpec.scala:1124)
[info] - should GET preview's stepRowCounts key set excludes a sibling node on an entirely different root (HEL-957 AC3, M4 fixture axis) *** FAILED ***
[info]   Set("0882f59a-bb05-4ac7-b80d-38aec02da989") was not equal to Set("0882f59a-bb05-4ac7-b80d-38aec02da989", "34e9ec11-4ff7-4255-a37a-d950985737f5") (PipelineRunServiceSpec.scala:1151)
[info] Tests: succeeded 1, failed 2, canceled 0, ignored 0, pending 0
```
Observed key set on the three-node fixture: exactly 2 keys (`{stepA, stepB}`) — **genuinely
different from M2's observed 1-key set (`{stepA}`)**. This is the discrimination evaluation-1.md
CR1 required: on the two-node fixture used in cycle 1, M2 and M3-replacement both produced
`{stepA}` and were observationally identical; on this three-node fixture they diverge for real.
Full transcript: `m3_replacement_evidence.txt`. Reverted after capture.

## M4 — Branching / multi-root ambiguity (FIXTURE axis, not a distinct code mutation)

Per design.md Decision 3's honest-accounting requirement: M4 is NOT a separate code edit. It is
the SAME M1 code mutation (`closureOf(...) -> sortedSteps.toVector` at line 507) re-run against
the second fixture ("...excludes a sibling node on an entirely different root"), where the
off-closure node lives on a structurally unrelated second pipeline root rather than merely being
an ancestor's other child. Its red evidence is already captured above under M1 and M2 (that test
failed identically in both mutation runs). Reported here separately only for bookkeeping, per
tasks.md 4.4/4.7 — not as an independent axis.

## Site 2 — `evaluateNodeRowsForBackfill` (line 662): widening mutation via the spy backend

Edit applied:
```scala
-                  val slicedSteps = NodeDependencyClosure.closureOf(allSteps.toVector, target)
+                  val slicedSteps = allSteps.toVector // HEL-957 MUTATION site2-M1
```
Command: same `testOnly ... -z HEL-957`.

Result: RED, right reason (key-set mismatch on the SPY's captured `steps` argument — the guard
that does not go through the masked node-keyed persisted-rows path). The two line-507 guard tests
were unaffected (green), confirming this mutation is isolated to the site-2 guard. This fixture
was NOT changed in cycle 2 (CR1 only concerned the line-507 fixture), so the cycle-1 transcript
still accurately describes the shipped code — verified unchanged by re-reading the current test
body before relying on it:

```
[info] - should GET preview's stepRowCounts key set observes exactly the target's dependency closure, excluding an off-closure sibling tail (HEL-957 AC1/AC2)
[info] - should GET preview's stepRowCounts key set excludes a sibling node on an entirely different root (HEL-957 AC3, M4 fixture axis)
[info] - should backfill's spy execution backend observes exactly the target's dependency closure, excluding an off-closure sibling tail (HEL-957 AC5) *** FAILED ***
[info]   Set("d8b03f82-3836-4cee-acaf-ecae05d32926", "1e6a01a3-6476-4622-823e-ee25cd225b83", "6e0e0f14-5c6e-4431-abbe-1f0968c05fed") was not equal to Set("d8b03f82-3836-4cee-acaf-ecae05d32926", "6e0e0f14-5c6e-4431-abbe-1f0968c05fed") (PipelineRunServiceSpec.scala:2047)
[info] Tests: succeeded 2, failed 1, canceled 0, ignored 0, pending 0
```
Full transcript: `site2_m1_evidence.txt`. Reverted after capture.

## Honest axis accounting (design.md Decision 3, gate CR4; corrected per evaluation-1.md CR1)

- **Distinct CODE-mutation axes at line 507, with distinct OBSERVED failures**:
  - **M1** (too wide) — observed key set gains an extra (off-closure) id: a **superset** failure.
  - **M2** (wrong node) — observed key set collapses to `{stepA}` alone: a **subset** failure,
    losing every id from `stepB` onward.
  - **M3-replacement** (`.dropRight(1)`) — observed key set is `{stepA, stepB}`: also a subset
    failure, but a DIFFERENT subset than M2's (`{stepA}`) — the three-node fixture makes this
    genuinely distinguishable from M2, which the cycle-1 two-node fixture could not do (both
    yielded `{stepA}` there and were, correctly, called out by evaluation-1.md CR1 as
    observationally identical on that fixture).
  - These are **three** distinct code-mutation axes, each demonstrated with a DIFFERENT observed
    key set. AC3's "more than one axis" bar was already met by M1 vs M2 alone (superset vs
    subset); M3-replacement is now also independently discriminable, not merely a differently-worded
    restatement of M2.
- **M3 original form** (`Vector(target)`): reds for the WRONG reason (engine failure, not a
  key-set mismatch) — explicitly NOT counted as an axis, per design.md's own rule that a red for
  an unrelated reason is not evidence.
- **M4**: NOT a distinct code axis — it is M1's exact code edit, re-run against a second,
  structurally different FIXTURE (two roots instead of an ancestor's sibling child). Reported as a
  fixture axis per design.md, not double-counted as a fourth code mutation.
- **Site 2 (line 662)**: one further distinct code-mutation axis (the widening mutation), guarded
  by a mechanism (spy backend) that is itself structurally different from the line-507 guards,
  since the site's own output is masked by the same node-keyed lookup that motivated this whole
  ticket.

Total: 3 distinct, independently-discriminable code-mutation axes at line 507 (M1, M2,
M3-replacement — each with its own distinct observed key set) + 1 fixture axis (M4, riding M1's
code edit) + 1 further independent code-mutation axis at line 662, all demonstrated red for the
right reason with captured verbatim output.

## Final state — all mutations reverted, full suite green

`git diff --stat -- backend/src/main` after every mutation was reverted: empty (no production
source, no migration).

`git diff --stat` against the cycle-1 commit, showing cycle 2's own delta (fixture lengthening +
dropped tautological assertions), from the worktree root:

```
 backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala | 44 +++++++++++++---------
 1 file changed, 26 insertions(+), 18 deletions(-)
```

Test-only change, as required.

Named tests + related specs, all green with mutations reverted
(`sbt "testOnly com.helio.api.routes.pipelines.PipelineRunRoutesSpec com.helio.services.pipelines.PipelineRunServiceSpec"`):

```
[info] Total number of tests run: 115
[info] Suites: completed 2, aborted 0
[info] Tests: succeeded 115, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

Full backend suite, all green with mutations reverted (`sbt test`), re-run fresh AFTER the
cycle-2 fixture change (lengthened trunk, dropped tautological assertions):

```
[info] Run completed in 4 minutes, 51 seconds.
[info] Total number of tests run: 3848
[info] Suites: completed 254, aborted 0
[info] Tests: succeeded 3848, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 295 s (0:04:55.0), completed Sep 5, 2026, 4:14:06 PM
```
