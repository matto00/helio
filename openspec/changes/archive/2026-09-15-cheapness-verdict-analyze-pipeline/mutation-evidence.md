# Mutation evidence — HEL-1092 (tasks.md 4.3, C2, C4)

Updated in cycle 2 (skeptic-final-1.md): `CheapOps` was changed from a derived formula
(`PipelineStep.Registry.keySet -- WriteBackOps`) to a hand-maintained literal `Set[String]`
(CR1), and the tautological D2 test was replaced with a real completeness/partition test plus a
regression test (CR2). M1 and M2 are re-run against the new shape below (their assertions and RED
output changed slightly because of the new "op coverage" tests); M3 is new, targeting C4's mandated
mutation of the literal allowlist itself.

All three mutations were applied to `PipelineCostEstimator.scala`, run against
`PipelineCostEstimatorSpec` via `sbt "testOnly com.helio.domain.engine.PipelineCostEstimatorSpec"`,
confirmed RED, then reverted. Post-revert the full suite is green (17/17, pasted below).

## M1 — delete the AI arm (`AiOps` check removed from `classifyStep`)

Mutation applied:

```scala
private def classifyStep(step: StepInput): Option[CostReason] =
  if (WriteBackOps.contains(step.op))   // AiOps check removed
    ...
```

RED output:

```
[info] estimate
[info] - should deny with ai-step when an enabled step uses analyzewithai over a small dataset root *** FAILED ***
[info]   Vector("unclassified-op") did not contain element "ai-step" (PipelineCostEstimatorSpec.scala:26)
[info] - should allow the same pipeline minus the AI step
[info] - should deny with generatetext as ai-step too *** FAILED ***
[info]   Vector("unclassified-op") did not contain element "ai-step" (PipelineCostEstimatorSpec.scala:43)
...
[info] - should collect multiple reasons rather than stopping at the first *** FAILED ***
[info]   Vector("unclassified-op", "unclassified-source", "row-estimate-unavailable") did not contain all of ("ai-step", "unclassified-source", "row-estimate-unavailable") (PipelineCostEstimatorSpec.scala:119)
[info] op coverage (skeptic-final-1.md CR2 / tasks.md C4)
[info] - should partition every registered op into exactly one of CheapOps, AiOps, WriteBackOps
[info] - should deny with unclassified-op an op that is registered-shaped but present in none of the three named sets
[info] Tests: succeeded 14, failed 3, canceled 0, ignored 0, pending 0
[info] *** 3 TESTS FAILED ***
```

Same failure shape as cycle 1: the AI-step pipeline still ends up `autoRunnable=false` after the
mutation (via `unclassified-op`, now correctly denied because `analyzewithai` is absent from the
hand-maintained `CheapOps`), so the reason-code-specific assertion is what must go red — and does.
The new "op coverage" tests are unaffected by this mutation (they don't touch `AiOps`), which is
the correct, narrow blast radius.

Reverted immediately after capture.

## M2 — add `analyzewithai` to the (now literal) `CheapOps` and remove the AI arm

Mutation applied:

```scala
val CheapOps: Set[String] = Set(
  "rename", "filter", "join", "compute", "groupby", "cast", "select", "limit", "sort",
  "aggregate", "splittext", "extractheadings", "chunkbytokencount", "datebucket", "pivot",
  "window", "unpivot", "dedupe", "fillnull", "stringops", "union", "lookup", "assert", "analyzewithai"
)
...
private def classifyStep(step: StepInput): Option[CostReason] =
  if (WriteBackOps.contains(step.op))   // AiOps check removed
    ...
```

RED output:

```
[info] estimate
[info] - should deny with ai-step when an enabled step uses analyzewithai over a small dataset root *** FAILED ***
[info]   true was not equal to false (PipelineCostEstimatorSpec.scala:25)
[info] - should allow the same pipeline minus the AI step
[info] - should deny with generatetext as ai-step too *** FAILED ***
[info]   Vector("unclassified-op") did not contain element "ai-step" (PipelineCostEstimatorSpec.scala:43)
...
[info] - should collect multiple reasons rather than stopping at the first *** FAILED ***
[info]   Vector("unclassified-source", "row-estimate-unavailable") did not contain all of ("ai-step", "unclassified-source", "row-estimate-unavailable") (PipelineCostEstimatorSpec.scala:119)
[info] op coverage (skeptic-final-1.md CR2 / tasks.md C4)
[info] - should partition every registered op into exactly one of CheapOps, AiOps, WriteBackOps *** FAILED ***
[info]   HashSet("analyzewithai") was not empty (PipelineCostEstimatorSpec.scala:142)
[info] Tests: succeeded 13, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
```

Confirms the `autoRunnable` assertion is a real, non-vacuous kill condition for this mutation, PLUS
(new in cycle 2) the "op coverage" partition test independently catches it too: `analyzewithai` is
not a registered op, so adding it to `CheapOps` makes `CheapOps -- registered` non-empty
(`HashSet("analyzewithai")`), which the `(CheapOps -- registered) shouldBe empty` assertion catches
directly. Two independent tripwires on the same mutation.

Reverted immediately after capture.

## M3 — remove `"filter"` from the hand-maintained `CheapOps` literal (NEW, C4's mandated target)

Mutation applied:

```scala
val CheapOps: Set[String] = Set(
  "rename", "join", "compute", "groupby", "cast", "select", "limit", "sort",   // "filter" removed
  "aggregate", "splittext", "extractheadings", "chunkbytokencount", "datebucket", "pivot",
  "window", "unpivot", "dedupe", "fillnull", "stringops", "union", "lookup", "assert"
)
```

`AiOps`/`WriteBackOps`/`classifyStep` unchanged -- `filter` is a real `PipelineStep.Registry`
entry, so this simulates exactly the C4 failure mode: a registered op silently absent from every
one of the three classification sets.

RED output:

```
[info] estimate
[info] - should deny with ai-step when an enabled step uses analyzewithai over a small dataset root
[info] - should allow the same pipeline minus the AI step *** FAILED ***
[info]   false was not equal to true (PipelineCostEstimatorSpec.scala:37)
[info] - should deny with generatetext as ai-step too
...
[info] op coverage (skeptic-final-1.md CR2 / tasks.md C4)
[info] - should partition every registered op into exactly one of CheapOps, AiOps, WriteBackOps *** FAILED ***
[info]   Set("filter") was not empty (PipelineCostEstimatorSpec.scala:138)
[info] - should deny with unclassified-op an op that is registered-shaped but present in none of the three named sets
[info] Tests: succeeded 15, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```

This is the exact tripwire skeptic-final-1.md CR2/C4 demands: `(registered -- classified) shouldBe
empty` fails, naming `filter` directly, and the pre-existing allow-case test (which used `filter`
as its one allowlisted step) fails too as a second independent signal. This mutation would NOT have
been caught by the old (cycle-1) derived-formula test (`CheapOps shouldBe (Registry.keySet -
"upsertsource")`), since that assertion was tautological against the production formula itself and
could never fail from a `CheapOps` edit alone under the old (derived) definition — this is the
concrete demonstration that the new hand-maintained-literal + partition-test combination closes the
gap the skeptic identified.

Reverted immediately after capture.

## Post-revert green baseline (17 tests, up from 16 in cycle 1 -- 2 new "op coverage" tests replace 1 tautological test)

```
[info] PipelineCostEstimatorSpec:
[info] estimate
[info] - should deny with ai-step when an enabled step uses analyzewithai over a small dataset root
[info] - should allow the same pipeline minus the AI step
[info] - should deny with generatetext as ai-step too
[info] - should deny with unclassified-op for an op outside the cheap allowlist and not a named deny op
[info] - should deny with writeback-step for upsertsource
[info] - should deny with remote-fetch for a rest_api root
[info] - should deny with remote-fetch for a sql root
[info] - should deny with remote-fetch for a URL-backed csv root
[info] - should deny with unclassified-source for an unresolved root
[info] - should deny with no-roots when the pipeline has zero roots
[info] - should deny with row-estimate-unavailable when no lastRunRowCount and a root's dataset count is unknown
[info] - should deny with rows-above-threshold when the estimate exceeds MaxAutoRunRows
[info] - should deny with steps-above-bound when enabled step count exceeds MaxAutoRunSteps
[info] - should sum dataset row counts across multiple roots when every root is a dataset with a known count
[info] - should collect multiple reasons rather than stopping at the first
[info] op coverage (skeptic-final-1.md CR2 / tasks.md C4)
[info] - should partition every registered op into exactly one of CheapOps, AiOps, WriteBackOps
[info] - should deny with unclassified-op an op that is registered-shaped but present in none of the three named sets
[info] Run completed in 576 milliseconds.
[info] Total number of tests run: 17
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```
