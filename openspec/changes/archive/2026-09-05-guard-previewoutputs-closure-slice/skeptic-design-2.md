## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Every claim below was checked against real source in this worktree, not against
the artifacts' narrative or round 1's report.

### What I verified (with evidence)

**CR3 (response shape) — LANDED.**
`grep` over `backend/src/main/scala/`:
`PipelineProtocol.scala:222 final case class OutputPreviewEntry(outputId: String, preview: RunResultResponse)`
and `:228 final case class PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])`.
design.md's Context now states exactly these and gives the access path
`envelope.outputs.map(_.preview.stepRowCounts.keySet)`; tasks 3.1/3.2 use `envelope.outputs`
and `preview.stepRowCounts.keySet`. The `entries` error is gone. (Nit: the file lives at
`api/protocols/pipelines/PipelineProtocol.scala`, not `api/protocol/`; line numbers are right.)

**CR2 (D2's unattainable rationale) — LANDED.**
D2 now explicitly withdraws the "closure of the wrong node vs closure minus its last element"
rationale, states why it was wrong (`:329-374` contains no slicing to perturb; the slice is at
`:507`, disqualified by AC2), and replaces it with three claims the chosen axes can actually
cash: a clearly non-empty expected key set, a second branch with a genuinely different closure
for M3, and an enabled off-closure node for AC3. All three are things M1/M2/M3 and D3 really
consume. No orphaned rationale remains.

**CR1 / D2a — the central question. LEGITIMATE DISCRIMINATOR, not a reworded claim.**
This is where I spent the round. D2a's criterion is the pair `(which guard reds, observed key
set)` plus a cross-arm GREEN control. I checked whether that is real or cosmetic by reading
`previewOutputs` (`PipelineRunService.scala:329-374`) directly:

- M1's site is inside `case Some(id) =>` — the `previewAtNode(pipelineId, output.node.stepId
  .map(_.value), output.node.rootId.map(_.value), user)` call at ~:344.
- M2's site is inside `case None =>` — the `Future.traverse(distinctNodeKeys) { case (stepKey,
  rootKey) => previewAtNode(pipelineId, stepKey, rootKey, user) }` at ~:361.

These are **two disjoint branches of the same `match`**. Guard 3.1 drives only the first, guard
3.2 only the second. So "under M1 the all-Outputs guard is GREEN" is not a restatement of the
key set — it is an independently falsifiable fact about code reachability that the run output
either shows or does not. That is materially stronger than HEL-957's cycle-1 error, where three
mutations at ONE site produced one observation under one guard and were relabelled three times.
Here the failing test identity differs, and that difference is mechanically visible in the sbt
output. I judge D2a a legitimate axis discriminator.

D2a's premise that the `{}` is structural is also verified, not taken on trust:
`previewAtNode`'s `case roots if targetStepId.isEmpty` arm calls
`backend.execute(pipeline, Vector(selectedRoot), Vector.empty, ...)` (:446) — an empty step
slice, so `outcome.stepCounts` is empty on a fixture of any length. "Do not lengthen the
fixture" (tasks 4.5) is therefore correct advice, and the round-1 remedy was indeed impossible.
tasks 4.5a makes the cross-arm greens *required pasted evidence*, and 4.5b names the collapse
outcome honestly. Good.

**AC2 (mutation on the previewOutputs path specifically) — satisfied by construction.**
All three axes sit at ~:344, ~:361, ~:368, inside `329-374`. None is at `:507`. tasks 4.4
restates the disqualification.

**No wrong-reason reds hidden in the chosen axes** (I checked each rather than trusting D4):
- M1: dropping `stepId` leaves `rootId = None` → `roots.head` fallback, no
  `UnprocessableEntity` (the fail-closed branch at :458 only fires for a *named* unresolvable
  root). Reds as a key-set mismatch. Correct.
- M2: the map key is built from the tuple `(stepKey, rootKey)` in `.map((stepKey, rootKey) -> _)`,
  NOT from the mutated argument, so `byNodeKey(...)` still resolves — no
  `NoSuchElementException`. Reds as a key-set mismatch. Correct.
- M3: `distinctNodeKeys.head` is total on a non-empty Outputs list and is always present in
  `byNodeKey`, so it reds with a non-empty WRONG set rather than throwing. Correct, and
  genuinely distinct from M1/M2 on the key set itself.
- The `.take(1)` variant is pre-recorded as a wrong-reason red and discarded (D4, tasks 4.6).

**AC3 (non-degeneracy demonstrated) — the trap is real and D3's remedy is a demonstration.**
`InProcessPipelineEngine.scala:449` is verbatim
`if (next.enabled) counts = counts.updated(next.id.value, nextFrame.size.toLong)`.
D3's positive control (show the off-closure node's id DOES appear in a key set when it is
genuinely inside a previewed closure) proves count-recordability on this fixture, which is what
`enabled = true` at insert time does not. tasks 2.2's STOP makes it blocking. Sound.

**D4's rejected rootId axis** — I re-derived it independently rather than inheriting round 1's
finding: the `targetStepId` non-empty arm passes the full `roots` vector to `backend.execute`
(:519) and resolves the ancestor by `parentStepId`, so dropping `rootId` for a step-bound Output
is a no-op; for a root-bound Output the slice is `Vector.empty`, so the key set is `{}` either
way. The rejection is correct and the assumption is defensible with the owner away.

### Verdict: CONFIRM

The plan is implementable as written, the round-1 defects are genuinely repaired against real
source (not just edited), and the one thing this round existed to adjudicate — whether D2a is a
legitimate discriminator or HEL-957's cycle-1 relabelling in new words — comes out on the side
of legitimate, for a reason I could check in the source rather than in the prose.

### Non-blocking notes

- **Fixture ambiguity worth pre-empting.** tasks 1.2 (an enabled node outside `target`'s
  closure) and 1.3 (a second branch with a different closure, carrying an Output) read as two
  separate nodes, while 1.4 seeds only two Outputs. If the executor makes the off-closure node a
  third node with no Output bound to it or below it, D3's positive control has no vehicle. The
  natural and cheapest reading — the off-closure node IS the second branch's Output-bound node,
  so guard 3.2's second entry doubles as the positive control — should be stated so it is not
  rediscovered at 2.2's STOP.
- design.md cites `api/protocol/PipelineProtocol.scala`; the real path is
  `api/protocols/pipelines/PipelineProtocol.scala`. Cosmetic.
- Reusing the existing `previewOutputs` describe block's `insertStep`/`seedPipeline` vocabulary
  (`PipelineRunServiceSpec.scala` ~:1155) keeps this evidence comparable to HEL-957's, as D1
  intends.
