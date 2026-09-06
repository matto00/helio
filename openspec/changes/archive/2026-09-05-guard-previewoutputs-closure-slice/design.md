## Context

`previewOutputs` (`PipelineRunService.scala:329-374`) has two arms, both of which delegate the
actual slicing to `previewAtNode`:

- **Single-Output arm** (`outputId = Some(id)`): resolves the Output, then calls
  `previewAtNode(pipelineId, output.node.stepId.map(_.value), output.node.rootId.map(_.value), user)`.
- **All-Outputs arm** (`outputId = None`): computes `distinctNodeKeys` as the distinct
  `(stepId, rootId)` pairs across the pipeline's Outputs, `Future.traverse`s one `previewAtNode`
  call per distinct key, then re-pairs each Output to its result via `byNodeKey(...)`.

The all-Outputs arm's dedup-and-re-pair logic is unique to `previewOutputs` — `previewStep` has no
analogue — so it is the single largest part of the caller-specific gap.

Response shape (`PipelineProtocol.scala:222,228`, verified at the design gate):
`PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])` and
`OutputPreviewEntry(outputId: String, preview: RunResultResponse)`. The observable's real access
path is therefore `envelope.outputs.map(_.preview.stepRowCounts.keySet)` — `stepRowCounts` being the
engine's per-node count map. That key set is what this change asserts on. It is the right observable because the target node's own rows are
read through the node-keyed lookup at `:527` and are therefore **invariant under a widening
mutation by construction** — asserting on rows would prove nothing (AC1).

## Goals / Non-Goals

**Goals**
- Guards on `previewOutputs`' own path, covering both arms.
- Each guard demonstrated RED under a mutation inside `previewOutputs`' body.
- Mutation axes that are **observationally distinct** from one another.
- Fixture non-degeneracy **demonstrated**, not asserted.

**Non-Goals**
- Re-proving HEL-957's `:507` guards. A `:507` mutation is explicitly disqualified (AC2).
- Any production source change. This is a test-only hardening ticket.
- Any migration, Playwright run, or e2e spec (HEL-972 holds those resources).

## Decisions

### D1 — Observable: `stepRowCounts.keySet`, per entry

Assert the executed node key set of each `OutputPreviewEntry`, not rows and not counts' values.
Directly satisfies AC1 and matches HEL-957's established observable, so the two bodies of evidence
are comparable.

### D2 — Fixture shape, and what it actually buys (restated at design gate round 1, CR2)

An earlier draft justified a three-node trunk by axes that "separate closure of the wrong node from
closure minus its last element." That rationale was wrong for this ticket and is withdrawn:
`previewOutputs`' body (`:329-374`) chooses the target/root and re-pairs results — **it contains no
slicing to perturb**. The slice lives at `:507`, which AC2 disqualifies. Trunk length therefore
buys nothing for the chosen axes by that argument.

What the fixture shape actually buys, and the only reasons it is specified:

1. **A clearly non-empty expected key set.** `stepA -> stepB -> target` gives an expected
   `{stepA, stepB, target}`, so an observed `{}` is an unmistakable RED rather than a
   one-element near-miss that could be argued about.
2. **A second branch whose closure genuinely differs**, so M3's re-pairing defect has something
   real to get wrong (an entry carrying a *non-empty but wrong* key set).
3. **An enabled off-closure node**, for AC3's non-degeneracy (see D3).

### D2a — The distinctness criterion (AC5), corrected

HEL-957's cycle-1 error was claiming three axes where two were observationally identical — one axis
wearing three labels. That trap is live here in a specific way the design gate caught: **M1 and M2
are the same transformation** (drop the target step id → `None`) applied at two different call
sites, and both yield `{}`. That `{}` is **structural, not fixture-dependent**: `targetStepId = None`
routes to the source-level arm, which calls `backend.execute(..., Vector.empty, ...)`, so
`stepCounts` is empty on a fixture of any length. "Lengthen the fixture until they differ" cannot
separate them and must not be attempted.

The criterion this plan actually relies on is the **pair** `(which guard test reds, observed key
set)` — not the key set alone. M1 and M2 are two axes only if, and precisely because:

- under M1, the **single-Output** guard reds and the **all-Outputs** guard stays **GREEN**;
- under M2, the **all-Outputs** guard reds and the **single-Output** guard stays **GREEN**.

Those cross-arm GREEN controls are themselves required evidence, captured per mutation. **If both
guards red under either mutation, that is a collapse** — it must be reported as one axis and the
claim must not be reworded to hide it.

### D3 — Non-degeneracy is demonstrated by a positive control, not asserted

`InProcessPipelineEngine` (`com/helio/domain/engine/InProcessPipelineEngine.scala`, ~:449) records
counts only for enabled nodes:

```scala
if (next.enabled) counts = counts.updated(next.id.value, nextFrame.size.toLong)
```

So an off-closure node that is disabled produces no `stepCounts` entry **whether or not it
executes** — the guard would be silently vacuous. Asserting `enabled = true` at insert time is not
enough either: it proves the flag, not that the node is count-recorded on this fixture.

The demonstration is a **positive control** in the same fixture: a companion assertion showing the
off-closure node's id DOES appear in a key set when it is genuinely inside the previewed closure
(e.g. previewing an Output bound to that node, or to a descendant of it). If the positive control
shows the id and the guard shows its absence, the guard's absence is load-bearing. If the positive
control cannot produce the id, the fixture is degenerate and must be fixed before the guard counts.

### D4 — Candidate mutation axes (all inside `previewOutputs`' body; none at `:507`)

These are candidates with a distinctness argument, not a fixed script. The executor runs them for
real and reports what was actually observed; any that collapse are merged or replaced per D2.

- **M1 — single-Output arm, target resolution.** `output.node.stepId.map(_.value)` -> `None`.
  Predicted: the single-Output guard reds with key set `{}` instead of `{stepA, stepB, target}`,
  **and the all-Outputs guard stays GREEN** (that green is the axis-separating evidence, per D2a).
- **M2 — all-Outputs arm, per-node target.** In the `Future.traverse`, `previewAtNode(pipelineId,
  stepKey, rootKey, user)` -> `previewAtNode(pipelineId, None, rootKey, user)`. Predicted: the
  all-Outputs guard reds with EVERY entry's key set `{}`, **and the single-Output guard stays
  GREEN**. M1 and M2 share the observed `{}`; they are separated by which guard reds, never by the
  set alone (D2a).
- **M3 — all-Outputs arm, re-pairing.** `byNodeKey((o.node.stepId..., o.node.rootId...))` ->
  `byNodeKey(distinctNodeKeys.head)`. Predicted: with two step-bound Outputs on branches with
  DIFFERENT closures, the second entry carries the first's key set — a mismatch with a **non-empty
  wrong value**, distinct from M1/M2 on the key set itself (both of which yield `{}`).
  `distinctNodeKeys` order follows `outputRepo.listByPipelineInternal`'s unpinned ordering, but the
  guard asserts each entry against its OWN closure, so M3 reds under any ordering as long as two
  Outputs have genuinely different closures. **Do not pin row order** to make this work.

**Recorded in advance as an expected wrong-reason red (AC4):** mutating `distinctNodeKeys` to
`.take(1)` makes `byNodeKey(...)` throw on the missing key. That is an exception, not a key-set
mismatch, so it is recorded and **discarded**, not banked as evidence.

**Explicitly rejected axis, with the reason stated:** dropping `output.node.rootId` in the
single-Output arm is *not* a usable axis for a step-bound Output. `previewAtNode`'s own contract
(`:395`) resolves the root by walking `parentStepId` against the full `roots` vector whenever
`targetStepId` is non-empty, "never from this parameter" — so the mutation is a genuine no-op there.
For a root-bound Output it IS live, but a root-bound preview runs an empty step slice, so its key
set is `{}` either way and cannot discriminate. Assumption stated rather than escalated (see
"Assumptions"): rootId threading on this path stays covered by HEL-913's existing tests, which
observe rows/source counts rather than key sets.

### D5 — Both arms get a guard

The all-Outputs arm's dedup/re-pair logic has no counterpart in `previewStep`, so omitting it would
leave the largest caller-specific surface uncovered while claiming the caller is guarded.

## Assumptions (product owner away; reversible, low-stakes, stated rather than escalated)

1. **Scope stays test-only.** No production behavior change is warranted — the ticket frames this as
   hardening and no defect was found during premise validation.
2. **The rootId axis is out of scope for a key-set guard** (D4's rejected axis), left to HEL-913's
   existing row-level coverage. Reversible: a follow-up could add a row/source-count guard for it.
   Had the owner been available, this is the one point I would have raised; I am proceeding on the
   stated reasoning rather than claiming a ruling.
3. **`stepRowCounts` remains the guard's observable** rather than a spy execution backend. HEL-957
   used a spy for the backfill site because that site returns no response; `previewOutputs` returns
   one, so the public observable suffices and keeps the guard coupled to behavior, not internals.

## Risks / Trade-offs

- **Risk: a guard that passes for the wrong reason.** Mitigated by D3's positive control and by
  requiring a real, run, verbatim RED per axis.
- **Risk: axis collapse restated as three claims.** Mitigated by D2 and by requiring the executor to
  paste the actual observed key set per mutation, so collapse is visible rather than arguable.
- **Trade-off: fixture length.** A three-node closure plus an enabled off-closure node plus a second
  branch for M3 is a larger fixture than HEL-957's. Accepted — D2 makes length the remedy for
  ambiguity.

## Migration Plan

None. Test-only; no schema, no migration, no rollout.

## Open Questions

None blocking. The one judgment call (D4's rejected rootId axis) is recorded as an assumption above
rather than parked as an escalation.
