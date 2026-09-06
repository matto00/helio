## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, then checked every load-bearing
claim against real source in this worktree (`75f59b04`).

**Claims that hold (verified, not taken on the artifacts' word):**

- `previewOutputs` at `PipelineRunService.scala:329`, two arms, both delegating to
  `previewAtNode`. Single-Output arm calls
  `previewAtNode(pipelineId, output.node.stepId.map(_.value), output.node.rootId.map(_.value), user)`;
  all-Outputs arm computes `distinctNodeKeys` as distinct `(stepId, rootId)` pairs,
  `Future.traverse`s one `previewAtNode` per key, re-pairs via
  `byNodeKey((o.node.stepId.map(_.value), o.node.rootId.map(_.value)))`. design.md's Context is accurate.
- `previewAtNode` defined at `:403`; the closure slice at `:507`
  (`NodeDependencyClosure.closureOf(sortedSteps.toVector, target)`) and the second at `:662`
  (`evaluateNodeRowsForBackfill`) both exist as described.
- AC1's rationale: the target's own rows are read at `:527` via
  `outcome.nodeOutcomes.get(StepKey(target.id.value))` — node-keyed, hence invariant under a
  widening mutation. Asserting on rows would indeed prove nothing. D1's observable choice is right.
- D3's degeneracy trap is real: `InProcessPipelineEngine.scala:449` is exactly
  `if (next.enabled) counts = counts.updated(next.id.value, nextFrame.size.toLong)`.
  A disabled off-closure node yields no `stepCounts` entry whether or not it executes. The
  positive-control remedy (show the id DOES appear when genuinely in-closure) is a sound
  demonstration, not an assertion.
- **D4's "explicitly rejected axis" is TRUE**, and I checked both halves independently rather than
  trusting the doc comment. `awk` over lines 470-560 (the `targetStepId` non-empty arm) returns
  **zero** occurrences of `rootId`; the arm passes the full `roots` vector to `backend.execute`
  and resolves the ancestor root by walking `parentStepId`. So dropping `output.node.rootId` for a
  step-bound Output is a genuine no-op. And for a root-bound Output the source-level arm calls
  `backend.execute(pipeline, Vector(selectedRoot), Vector.empty, ...)` — an empty step slice, so
  `stepCounts` is empty regardless of which root is selected, and the axis genuinely cannot
  discriminate on a key-set observable. Assumption 2 is defensible; proceeding without escalation
  is the right call here.
- M3's chosen form (`byNodeKey(distinctNodeKeys.head)`) is total and will not throw, unlike the
  `.take(1)` variant D4 correctly pre-records as a wrong-reason red. Good discrimination between
  the two.
- HEL-957's standard (`openspec/changes/archive/2026-09-05-guard-preview-prefix-slicing/mutation-evidence.md`
  plus `m1/m2/m3_*_evidence.txt`): per-axis diff, command, verbatim RED, wrong-reason section,
  final-revert confirmation. tasks.md 5.1/5.2/4.7 match that bar.

**Claims that do not hold — see Change Requests:** the response-envelope shape in design.md's
Context, and the AC5 distinctness machinery in D2/D4/tasks 4.5.

### Verdict: REFUTE

The plan is close and its hardest judgment call (the rejected rootId axis) survives scrutiny. It
fails on the one thing the ticket singles out as non-negotiable: AC5's axis-collapse test, as
written, is **unsatisfiable by the prescribed remedy** for the axes actually chosen.

### Change Requests

1. **AC5 is not satisfiable as planned — M1 and M2 are predicted to produce IDENTICAL observed
   output, and tasks.md 4.5's remedy cannot fix it.**
   design.md D4 predicts M1 yields key set `{}` and M2 yields `{}` for every entry. Both mutations
   are literally the same transformation (drop the target step id → `None`) applied at two call
   sites. tasks.md 4.5 then instructs: "If any two are IDENTICAL, that is ONE axis: lengthen the
   fixture until they differ." **Lengthening the fixture cannot help**: `{}` is structural, not
   fixture-dependent — `targetStepId = None` routes to the source-level arm, which calls
   `backend.execute(..., Vector.empty, ...)` (verified at `:445`), so `stepCounts` is empty on any
   fixture of any length. The executor following 4.5 literally will either chase a fixture that can
   never separate them, or reword the claim — which is precisely HEL-957's cycle-1 failure the
   ticket forbids.
   Required: state in D4 (and mirror in tasks 4.5) the distinctness criterion the plan actually
   relies on — the **pair** `(which guard test reds, observed key set)`, not the key set alone —
   and add explicit tasks requiring the executor to capture the **cross-arm control**: under M1 the
   all-Outputs guard must be GREEN, and under M2 the single-Output guard must be GREEN. That green
   is the evidence that makes M1 and M2 two axes rather than one wearing two labels; without it
   they are one. If the executor observes both guards redding under either mutation, that is a
   collapse and must be reported as such.

2. **D2's stated rationale for the three-node fixture is unattainable within this ticket's mutation
   scope, and must be restated.**
   D2 justifies the three-node trunk by axes that "separate closure of the wrong node from closure
   minus its last element" — but neither of those axes appears in D4, and neither is reachable from
   inside `previewOutputs`' body (lines 329-374 choose the target/root and do the re-pairing; they
   contain no slicing to perturb — the slice lives at `:507`, disqualified by AC2). So the trunk
   length does nothing for M1/M2/M3 as specified. Required: either restate D2's rationale in terms
   of what the trunk actually buys the chosen axes (a non-trivial, clearly-non-empty expected key
   set so an `{}` observation is an unmistakable RED, plus a second branch whose closure genuinely
   differs for M3), or add an axis that trunk length actually discriminates and show it lives
   inside `previewOutputs`' body. Do not leave a rationale in the design that the axes cannot cash.

3. **design.md states the response shape incorrectly; tasks 3.1/3.2 inherit the error.**
   design.md line 15 says `PipelinePreviewResponse(entries: Vector[OutputPreviewEntry])`. Actual
   (`PipelineProtocol.scala:228`): `final case class PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])`,
   and `OutputPreviewEntry(outputId: String, preview: RunResultResponse)` (`:222`). The real access
   path for the observable is `envelope.outputs.map(_.preview.stepRowCounts.keySet)`, not
   "the entry's `stepRowCounts`". Correct the field names in design.md's Context/D1 and in tasks
   3.1/3.2 so the plan states the contract it is actually guarding.

### Non-blocking notes

- M3 depends on `distinctNodeKeys.head` being the "wrong" key for at least one entry, and
  `distinctNodeKeys` order follows `outputRepo.listByPipelineInternal`'s (unpinned) ordering. The
  guard in tasks 3.2 is order-independent (each entry asserted against its OWN closure), so M3 reds
  under any ordering as long as the fixture contains at least two Outputs with genuinely DIFFERENT
  closures. Worth saying that explicitly in D4 so the executor does not start pinning row order.
- The existing `previewOutputs` describe block starts at `PipelineRunServiceSpec.scala:1155` and
  already carries an `insertStep`/`seedPipeline`/`addSecondRoot` fixture vocabulary (see the HEL-957
  block at `:1131`). Reusing those helpers, rather than authoring new ones, will keep the new guards
  comparable to HEL-957's evidence as D1 intends.
- Assumption 3 (public observable over a spy backend) is well-reasoned — `previewOutputs` returns a
  response, unlike the backfill site — and needs no revision.
