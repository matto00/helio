# Design — Guard previewAtNode's dependency-closure slicing

## Context

`previewAtNode` (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`) slices the
pipeline's steps to the target's dependency closure before executing:

```scala
val target      = sortedSteps(k)                                            // line ~506
val slicedSteps = NodeDependencyClosure.closureOf(sortedSteps.toVector, target)  // line 507
```

and then reports the target's rows through the HEL-905 node-keyed lookup:

```scala
val targetRows = outcome.nodeOutcomes.get(StepKey(target.id.value)).map(_.rows).getOrElse(outcome.rows)  // line 527
```

The ticket's cited line (403) and mechanism (`pathToRoot`) are stale; the behaviour is the same.

## Decision 1 — Observe the executed node SET, via `stepRowCounts`, at the route level

The masking is structural: any assertion on the TARGET's own rows is blind to which OTHER nodes ran, because
the target's node outcome is unaffected by them. So the guard must assert on something computed across all
executed nodes. `outcome.stepCounts` is threaded straight into `RunResultResponse.stepRowCounts` at line 536
without passing through the node-keyed lookup, and HEL-922 already established it as a wire-level assertable
field. Asserting `resp.stepRowCounts.keySet` therefore observes the slice directly.

**Verification obligation (not an assumption):** that `stepCounts` is keyed per executed node, and gains a key
when an off-path node is executed, must be CONFIRMED by running the widening mutation and observing red — not
inferred from the field's name. If it turns out `stepCounts` is populated for a fixed key set independent of
the slice, this decision is refuted and the guard must instead observe the slice some other way (e.g. an
`AssertionSink`/engine-level probe). Record whichever holds.

## Decision 2 — Non-degeneracy is a fixture property, and must be constructed deliberately

Every existing near-guard fails because its fixture makes correct and broken outputs coincide: the pipelines
contain only on-path steps, so `closure == fullList`. The fixture here MUST contain at least one node outside
the target's closure, and the expected key set must be a PROPER subset of the pipeline's node set. State the
two sets explicitly in a comment so a later reader can check non-degeneracy without re-deriving it.

**Disabled-node degeneracy (design gate CR3).** `InProcessPipelineEngine.scala:449` guards the counts update with
`if (next.enabled)`, so a DISABLED node never gets a `stepCounts` key even when it is executed. Two consequences
the fixtures must handle explicitly, not incidentally:

- Every fixture node OUTSIDE the target's closure must be `enabled = true`. A disabled off-closure node makes M1
  silently non-discriminating — the widened slice executes it and the key set does not change. This is precisely
  the "fixture where correct and broken output coincide" trap, and it would look like a passing guard.
- The expected value is "the ENABLED members of the target's closure", not "the target's closure". State it that
  way in both the assertion and the comment required by task 2.3.

## Decision 3 — Mutation set spans multiple axes (the explicit acceptance bar)

A mutation set complete along one axis reads as rigor and is not. Required axes, each applied to the real
source, run, and its failure output captured:

| # | Axis | Mutation at line 507 | Expected discrimination |
| - | ---- | -------------------- | ----------------------- |
| M1 | Slice too wide | `closureOf(...)` -> `sortedSteps.toVector` | off-path node appears in `stepRowCounts` keys |
| M2 | Wrong node targeted | `closureOf(sortedSteps.toVector, target)` -> `closureOf(sortedSteps.toVector, sortedSteps.head)` (or another non-target node) | key set is the wrong node's closure |
| M3 | Degenerate / off-by-one at the target end | `closureOf(...)` -> `Vector(target)` (self-only, ancestors dropped) | key set loses the target's ancestors |
| M4 | Branching / multi-root ambiguity | M1 re-run against a second fixture with a join or two roots, where a sibling lane exists that is NOT in the target's closure | sibling-lane nodes appear in the keys |

**Honest axis accounting (design gate CR4).** M4 is the SAME code mutation as M1 applied to a different fixture.
If M3 also fails to red for the right reason, the surviving true CODE-mutation axes collapse to M1 and M2 alone —
which is the single-axis trap this ticket warns about, wearing four labels. M3 is at concrete risk of this:
dropping a target's ancestors leaves the engine's `isReady` unsatisfiable, so `loop` is expected to fail with a
`LaneReferenceError` and the test reds on a 500 rather than on a key-set mismatch. That is a red for the wrong
reason and does NOT count as an axis.

**Pre-committed M3 replacement, so the substitution is not improvised at execution time:** if M3 reds for the
wrong reason, replace it with `closureOf(sortedSteps.toVector, target).dropRight(1)` — an off-by-one at the
TERMINAL end that still executes a valid, connected slice, so the engine succeeds and the failure is a genuine
key-set mismatch. Record which of the two M3 forms was used and why.

M4 remains worth running as a distinct FIXTURE axis, and is reported as such (a fixture axis, not a code axis): it is the shape where "prefix" is genuinely
ambiguous, and a guard that only ever sees a linear trunk cannot speak to it. If a mutation turns out NOT to
be discriminable (e.g. M3 makes the engine fail before producing a response, so the test goes red for the
wrong reason), say so explicitly in the evidence and substitute a mutation that fails for the RIGHT reason —
a red for an unrelated reason is not evidence.

## Decision 4 — The second slicing site is `evaluateNodeRowsForBackfill` (line 662), and it needs a SPY, not an output assertion

Corrected at the design gate (round 1, CR1/CR2). The plan previously called this site `previewOutputs`; that is
wrong and verified wrong. `grep -rn "closureOf" backend/src/main/scala` returns exactly two production call
sites: `PipelineRunService.scala:507` and `:662`. Line 662 lives in
`private def evaluateNodeRowsForBackfill(...): Future[Unit]`, reached from `def backfillOutputNode` (:592).
`previewOutputs` (:329) does not slice at all in its own body — but note (round-2 note 1) that it DELEGATES to
`previewAtNode` (:403), which owns the :507 slice, so `previewOutputs` IS covered by the :507 guard. Both
`previewStep` (:293) and `previewOutputs` (:329) reach :507 that way. What does not exist is a separate
`previewOutputs`-local slice; an implementer sent looking for one will find nothing.

**Its only observable output is provably masked.** `evaluateNodeRowsForBackfill` returns `Future[Unit]`, discards
`outcome.stepCounts` entirely, and persists only the target's rows — read through the SAME node-keyed lookup at
:664 (`outcome.nodeOutcomes.get(StepKey(target.id.value)).map(_.rows).getOrElse(outcome.rows)`). So any assertion
on the persisted rows is invariant under the widening mutation by construction. That is exactly the masked,
non-discriminating test this ticket exists to prevent, and it must not be written.

**The mechanism that does discriminate: a spy execution backend.** `PipelineRunService` takes an injectable
`executionBackend` (`PipelineRunService.scala:108`: `if (executionBackend != null) executionBackend else new
InProcessExecutionBackend(...)`). A spy `PipelineExecutionBackend` that captures the `steps: Vector[PipelineStep]`
argument handed to `execute` observes the slice directly, at both sites, with no production change. Guard line 662
this way, with at least the M1 widening mutation demonstrated red.

**The escape hatch is closed.** Scoping this site out is permitted ONLY after demonstrating, with captured output,
that the spy-backend approach itself fails — not on a judgement that the site is "hard to assert". A silent drop
here leaves the identical hole one call site over.

## Decision 5 — Test-only; no production diff, no migration

The slicing is correct. A production-source change in this diff is out of scope and should be treated as a
defect in the work, not a bonus. No migration under any circumstances: the dev Postgres is shared with
concurrent runs (HEL-972, HEL-956) and a stray migration poisons `flyway_schema_history` for them. If the work
appears to need one, escalate rather than adding it. Use the existing spec harness's EmbeddedPostgres; do not
touch the shared dev database. Do not use Playwright and do not run e2e specs — another run holds the browser.

## Evidence artifact

Write `mutation-evidence.md` in this change directory: for each of M1-M4 (plus the `previewOutputs` mutation),
the exact source edit applied, the exact command run, and the verbatim failure output, plus the final all-green
run with every mutation reverted. "Would fail" is not admissible; only observed output is.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` hook and no script invoked by one. It adds test code under
`backend/src/test/` only. **What does it execute?** Nothing new at commit time; the added specs run inside the
existing `sbt test` gate. **What environment does it inherit, and from where?** The existing backend test
harness (EmbeddedPostgres per spec), unchanged. **Does it write anything outside its own sandbox?** No — no
shared-database writes, no filesystem writes outside the change directory's evidence artifact. **Does it behave
differently from a linked worktree than from a main checkout?** No. **What happens on its first run?** Same as
any other backend spec.
