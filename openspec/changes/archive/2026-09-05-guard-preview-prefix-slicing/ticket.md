# HEL-957: previewAtNode's prefix-slicing has no suite-wide guard

## Description

`previewAtNode`'s dependency-closure slicing in
`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`
has no suite-wide guard. Widening the slice to the pipeline's full step list
(i.e. executing nodes that are NOT in the target's dependency closure) leaves
the test named for this behaviour — `GET /pipelines/:id/steps/:stepId/preview
only applies steps up to and including the target step` (`PipelineRunRoutesSpec`)
— green, and the whole backend suite green.

This is a coverage hole, not a product defect. The slicing code is correct;
nothing asserts that it is.

### Why nothing catches it

The named test's assertion is guarded only by the CONJUNCTION of two mechanisms
and independently guards neither:

1. the prefix/closure slicing (`NodeDependencyClosure.closureOf(...)`), and
2. the HEL-905 node-keyed outcome lookup —
   `outcome.nodeOutcomes.get(StepKey(target.id.value)).map(_.rows).getOrElse(outcome.rows)`

The response reads the TARGET step's own node-keyed outcome, so widening which
OTHER nodes get evaluated does not change the target's recorded row count:
mechanism 2 masks mechanism 1.

### Premise validation (2026-09-05, corrected inline)

The ticket cites line 403 and `pathToRoot(target, Vector(target))`. Both are
stale. The live mechanism is `NodeDependencyClosure.closureOf`, at:

- line 507 — `closureOf(sortedSteps.toVector, target)`, the `previewAtNode`
  step-preview path (the site the ticket is about), and
- line 662 — `closureOf(allSteps.toVector, target)`, the `previewOutputs` path
  (a SECOND site the ticket did not know about).

The masking lookup is now at line 527. Nearest existing candidate guards, and
why each fails to discriminate the widening mutation:

- `PipelineRunServiceSpec.scala:1047` ("resolves the target step's prefix from
  its parentStepId ancestor chain, excluding an unrelated tail (AC5.5)") —
  has an off-path tail `t`, but asserts on `result.rows.size`, which is read
  through the node-keyed lookup, so executing `t` as well does not change the
  target's own node outcome.
- The HEL-922 `stepRowCounts` route tests — assert the full expected map, but
  on pipelines whose steps are ALL on the target's path, so the closure and
  the full step list coincide.
- `NodeDependencyClosureSpec` — unit-tests `closureOf` in isolation; does not
  guard that `previewAtNode` actually calls it.

## Acceptance Criteria

1. A test exists whose assertion observes WHICH nodes a preview actually
   executed — not the target node's own recorded rows — on a pipeline that
   contains at least one node OUTSIDE the target's dependency closure.
2. That guard is demonstrated RED under a mutation that widens the slice at
   line 507 (`closureOf(sortedSteps.toVector, target)` -> `sortedSteps.toVector`)
   with the node-keyed lookup at line 527 left INTACT. The red must be produced
   by actually applying the mutation and running the test, and the failure
   output captured as evidence — not reasoned about.
3. The mutation set covers MORE THAN ONE axis of wrongness. At minimum, the
   guard must also be shown red under a second, structurally different mutation
   (e.g. targeting the wrong node, an off-by-one at the target end, or a
   degenerate empty/self-only slice) — a mutation set complete along a single
   axis is not sufficient.
4. The fixture is non-degenerate: the correct expected value differs from the
   value produced under each mutation. A fixture where correct and broken
   outputs coincide does not satisfy this, even if the test passes.
5. The second slicing site (line 662, `previewOutputs`) is either guarded by
   the same standard or explicitly and reasonably scoped out in `design.md`
   with a filed follow-up.
6. The full backend suite is green with the mutations reverted.

## Constraints

- Test-only change. No production behaviour change is expected or wanted.
- NO database migration. If one appears necessary, escalate first — the dev
  Postgres is shared with concurrent runs and a stray migration poisons
  `flyway_schema_history`.
- Do NOT use Playwright and do NOT run e2e specs — another run holds the
  browser.
- Prefer a spec with its own EmbeddedPostgres over anything touching the
  shared dev database.
