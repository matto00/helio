## Skeptic Report — final gate, dimension `migration-correctness` (round 7, HEAD `1e56bc04`)

### Verdict: REFUTE

Round 6's Change Request 1 is **genuinely and correctly fixed**. I verified the fix against real
scrubbed dump data on a fresh embedded Postgres, reproduced the mutation proof myself, re-ran the
full suite fresh single-threaded (3367/3367, exit 0), and completed the requested exhaustive
`parent_step_id`-writer sweep — which found **no sibling gap** this time. The trunk-continuation
behavior is tree-correct for arbitrary shapes, including a tail-bearing trunk-last anchor.

The one thing that stops this shipping is small and contained: the fix makes a **wire-visible**
change to `POST /api/pipelines/:id/steps` (the `position` in the 201 response is now always `0`
instead of `MAX(position)+1`) and **no spec/schema delta was written for it** — the binding
`openspec/specs/pipeline-steps-persistence/spec.md` and
`schemas/pipelines/create-pipeline-step-request.schema.json` both still document the replaced
append contract in prose that is now false. Doc-only; no code change needed.

---

### What I verified (with evidence)

**0. Ground truth.** `git show HEAD` in full; read `PipelineService.persistNewStep` (both branches),
`duplicateStep`, `updateStep`; `PipelineStepRepository` (`insert`, `insertInternal`,
`insertAtInternal`, `spliceInsertAtInternal`, `reorderInternal`, `deleteInternal`, `siblingsQuery`,
`trunkOf`, `tailsOf`, `childrenOf`, `executionOrder`); `PipelineProposalService.createPipeline` /
`addSteps`; `PatchSetApplyRollback`; `PatchSetUndoService` / `PatchSetUndoInverse`;
`PipelineStepProtocol`; the V94 migration's `parent_step_id` DML; `PipelineDetailPage.tsx`. Working
tree clean throughout (verified after every mutation/probe).

**1. The trunk-resolution + splice logic is tree-correct, reasoned and then measured.**
`persistNewStep`'s no-`position` branch resolves `trunkOf(current).lastOption` and calls
`spliceInsertAtInternal(parent = that)`. Case analysis against the established primitive:
- *Empty pipeline* → `trunkOf` empty → anchor `None` → new row at root, `position = 0` → correct
  trunk head.
- *Pure trunk* → anchor = trunk-last, which by definition has no children → `siblingsQuery` empty →
  no reparenting → new step becomes the sole position-0 child → new trunk-last.
- *Trunk-last node that already bears tails* (the case the brief singled out) → all of the anchor's
  existing children (its tails) are reparented onto the new step per
  `spliceInsertAtInternal`'s already-ruled semantics; the new step is the anchor's sole position-0
  child, so it is the new trunk-last and the tails are emitted after it in `executionOrder`.
  **Measured, not just reasoned** — see Probe 2 below.
- *Pipeline with stray root-level tails* (legacy flat shape) → anchor is still the position-0 root
  chain's last node; the stray root tails are untouched and still appended last by
  `executionOrder`. Correct.

**2. Exercised against real data myself.** Wrote `SkepticProbe7Spec` (same harness as
`V94OutputsMigrationSpec`: EmbeddedPostgres → Flyway to V93 → truncate → load
`db/fixtures/hel904-real-dump.sql` verbatim → Flyway to latest/V94), calling an **exact replica of
`persistNewStep`'s no-`position` branch** (`listByPipelineInternal` → `trunkOf(...).lastOption` →
`spliceInsertAtInternal`) — not a reimplementation of the algorithm. Deleted afterwards; `git
status` verified clean. Output:

```
PROBE 1 — the 3 largest real migrated pipelines, 2 default addStep calls each
PIPELINE 6ba5075b-2291-4508-881b-a517b1f300cf
  BEFORE n=20 trunk=4287->...->76af nodeKey=Some(76af) tails=Vector()
  AFTER  n=22 trunk=4287->...->76af->15cd->00bd nodeKey=Some(00bd) tails=Vector()
PIPELINE 555f4bae-7c76-4566-84eb-036bc33b4485
  BEFORE n=5 trunk=b6ac->b98b->18ed->41a4 nodeKey=Some(41a4) tails=Vector(hel9)
  AFTER  n=7 trunk=b6ac->b98b->18ed->41a4->dbd7->d3a0 nodeKey=Some(d3a0) tails=Vector(hel9)
  EXEC   b6ac->b98b->18ed->41a4->dbd7->d3a0->hel9
PIPELINE 63130b24-78f3-41b1-b934-cac6c7130f0e
  BEFORE n=4 trunk=8a42->e820->122e->466d nodeKey=Some(466d)
  AFTER  n=6 trunk=8a42->e820->122e->466d->fe58->001f nodeKey=Some(001f)

PROBE 2 — trunk-last anchor that ALREADY has a migration-shaped tail (position 1)
  BEFORE n=3 trunk=047d->b61a nodeKey=Some(b61a) tails=Vector(probe7-tail)
  AFTER  n=4 trunk=047d->b61a->bb84 nodeKey=Some(bb84) tails=Vector(probe7-tail)
  EXEC   047d34->b61a6e->bb84c4->probe7-tail
  probe7-tail.parent_step_id now = bb84c4   (reparented onto the new step, per splice semantics)
```
In every case the trunk grew by exactly the steps added, in order; the run-result node key
(`trunkOf(steps).lastOption`, `PipelineRunService`) and the Output binding
(`createdSteps.lastOption`, `PipelineProposalService`) resolve to the **same** id; `executionOrder`
contains every step exactly once. Round 6's Probes A and B no longer reproduce.

**3. Mutation proof reproduced by me, not taken on report.** Reverted the no-`position` branch to
the old bare `insertInternal(...)` and ran `PipelineStepRoutesSpec`:
```
- should POST without an explicit position extends the trunk ... *** FAILED ***
- should addStep x3 with no explicit position builds a genuine trunk ... *** FAILED ***
Tests: succeeded 62, failed 2
```
Restored the file (`git diff --stat` → clean); full suite green below. Both new guards are genuinely
failable, and the counts match the executor's report exactly (62/64 → 64/64).

**4. Spot-checked 5 of the 9 rippled tests — all genuinely intent-preserving.**
- *Expectation correction* `"POST auto-increments position"` → `"POST without an explicit position
  extends the trunk"`: `position shouldBe 1` → `shouldBe 0` is **correct**, not made-to-pass —
  `position` is now a sibling-scoped tiebreaker and the new step is the sole member of a fresh child
  group. The test is *stronger* than before: it now also asserts the persisted
  `parentStepId == Some(idA)` via `findByIdInternal`, which the wire `position` alone cannot show.
- *Expectation correction* `"GET returns steps ordered by position"` → asserts `Vector(idA, idB)`
  by id rather than `Vector(0, 1)` by position. Correct: with all positions now `0`, the old
  assertion would have been vacuous; the id assertion preserves (and sharpens) the real intent
  ("GET returns steps in the right order").
- *SQL-seeding switches* `"PUT .../steps/order reindexes positions 0..n-1"` and
  `"failed reorder (422) leaves positions unchanged"` (and the same switch in
  `AuditMutationInstrumentationSpec`'s reorder-audit test): `reorderInternal` is sibling-scoped by
  the round-5 binding ruling, so it is only exercisable on a genuine sibling group — a shape the
  fixed `addStep` deliberately no longer produces. Seeding flat root siblings via `sqlu` reproduces
  the **exact fixture shape these tests previously got from `addStep`**, so their intent is
  preserved verbatim, not weakened.
- *SQL-seeding switches* on `"POST with position: 0 / in the middle / == count / heals gaps"` and
  `"duplicate clones directly after the original"`: same reasoning. I specifically checked whether
  this leaves the explicit-position and duplicate paths untested against realistic (parent-chained)
  data — it does **not**: `PipelineStepRoutesSpec:992`, `:1140` and `:1183` already cover exactly
  those paths on migrated trunk shapes (including a tail-bearing anchor), and
  `PipelineStepRepositorySpliceSpec` covers the primitive. No coverage was lost.

**5. Full suite, fresh, single-threaded (HEL-924 protocol).**
`sbt -batch 'set Test/parallelExecution := false' test`:
```
[info] Tests: succeeded 3367, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
EXIT=0
```
(`…/scratchpad/full7.log`. +2 vs round 6's 3365 = the two new trunk tests. No flake this time;
`target/test-reports` pre-created.)

**6. Exhaustive `parent_step_id`-writer sweep — NO sibling gap this round.**
`grep -rn "parentStepId\s*=\|parent_step_id"` across `backend/src/main/scala`,
`backend/src/main/resources/db/migration`, and `helio-mcp/src`: outside
`PipelineStepRepository.scala` the **only** writers are the V94 migration's two step INSERTs
(`:599`, `:834`), each of which anchors on an explicitly-resolved `trunk_last_id` / `chain_parent`
(guarded by `((parent_step_id IS NULL AND … IS NULL) OR parent_step_id = …)`) — deliberate,
correct anchors. Within the repository the writers are `insert`, `insertInternal`,
`insertAtInternal` (all leaving `parentStepId` at its `None` default), `spliceInsertAtInternal`
(explicit anchor), and `deleteInternal`'s splice-on-delete (writes the head child into the deleted
row's own parent/position slot — correct).

The decisive check: **who still calls the `None`-defaulting creators from main code?** Nobody.
`grep -rn "\.insert(\|insertInternal(\|insertAtInternal(\|spliceInsertAtInternal("` over
`backend/src/main/scala` returns, for steps, exactly two call sites —
`PipelineService.scala:610` and `:638`, both `spliceInsertAtInternal` with a resolved anchor. Every
step-creation entry point funnels through `PipelineService.addStep`
(`PipelineStepRoutes:29`, `PatchSetUndoService:242`, `PatchSetApplyRollback:173`,
`PipelineProposalService:467`) or `duplicateStep` (`:890`, splice with `Some(existing.id)`).
`insert` / `insertInternal` / `insertAtInternal` are now **test-seeding-only** in main code. Round
6's failure mode (an unaudited writer class) does not recur.

I also confirmed `PipelineProposalService.addSteps` is a sequential `foldLeft` over `addStep`, so
`createdSteps.lastOption` is provably the last-added step — which, post-fix, is provably
`trunkOf(...).lastOption` (asserted end-to-end by the new `PipelineStepRoutesSpec` test).

---

### Change Requests

**1. The wire-visible `position` semantics of `POST /api/pipelines/:id/steps` changed, and the
binding spec + schema still document the replaced contract.**

Before this commit, an append returned `position = MAX(position)+1`; it now always returns
`position = 0` (a fresh, single-member sibling group), and placement is carried by
`parent_step_id`. The change is correct — but two binding contract documents still assert the old
behavior in prose:

- `openspec/specs/pipeline-steps-persistence/spec.md:99-100` — *"**`position` absent (default — the
  pre-existing contract, unchanged):** the step is appended with the next available position
  (MAX(position)+1 or 0 if no steps exist)."* This is now false on both counts (it is not
  unchanged, and it is not MAX+1). The same requirement block's `position`-present bullet still
  describes an index "into the pipeline's current position-sorted step list" and a whole-pipeline
  "renumbered contiguously (0..n)", both superseded by the round-4/round-5 splice + sibling-scoped
  rulings. There is a `pipeline-step-tree` delta in this change but **no
  `pipeline-steps-persistence` delta at all** (`ls openspec/changes/outputs-model-migration/specs/`
  confirms), so nothing in the change reconciles this.
- `schemas/pipelines/create-pipeline-step-request.schema.json:5` — same stale prose ("index into the
  pipeline's current position-sorted step list. Absent means append (the pre-existing behavior,
  unchanged)"). Per CLAUDE.md, `schemas/` is the contract's source of truth and schema updates
  belong in the same change as the code.
- Lower-priority, same root cause: `PipelineStepProtocol.scala:145-151`'s
  `CreatePipelineStepRequest` scaladoc repeats the identical stale claim, and the
  `"First step gets position 0"` scenario name in the spec is now trivially true for *every* step.

Required: add a `pipeline-steps-persistence` spec delta (and update the schema description +
protocol scaladoc) stating the shipped contract — `position` absent extends the **trunk** (splices
as the current trunk-last step's sole child, sibling-scoped `position = 0`); `position` present is
a **whole-pipeline execution-order index** translated to a splice anchor; `position` is a
sibling-scoped tiebreaker, never a whole-pipeline ordering key.

**Classification: ordinary, contained, documentation-only.** No code change, no design question, no
behavioral ambiguity — the shipped behavior is the one `design.md` and the `pipeline-step-tree`
delta already rule as correct; only the older sibling spec/schema was never updated to match. The
orchestrator's close-it-out discretion applies. I verified this is **not** a user-visible break:
the frontend's `Step` type carries no persisted `position` (`StepCard.tsx:86`, Decision 9) and
`PipelineDetailPage.handleInsertStep` uses list index only, so no client consumes the returned
`position`.

### Non-blocking notes

- **`persistNewStep`'s new comment overclaims.** It says the no-`position` path and "append at
  `position == count`" now "behave identically". They do not when the pipeline has tails: the
  no-`position` branch anchors on `trunkOf(current).last`, while the `Some(count)` branch anchors on
  `current(count-1)` — the last step in **execution order**, which is a tail node whenever the
  pipeline ends in one. Both are defensible under their own (already-ruled) semantics; only the
  claim of equivalence is wrong. Worth softening the comment.
- **Undo/rollback of a step deletion now always lands the restored step at the trunk end.**
  `PatchSetApplyRollback:173-187` and `PatchSetUndoService:235-258` recreate via `addStep` (no
  position) then attempt `updateStep(position = prior.position)`. Post-fix the recreated step is the
  sole member of its sibling group, so the sibling-scoped clamp makes that reposition a structural
  no-op — a mid-trunk step is restored at the end of the trunk, which changes what the pipeline
  computes. I am **not** raising this as a Change Request: both call sites already document
  "content restoration (not position) is the bar", and the underlying cause is round-5's binding
  sibling-scoped-PATCH ruling, not this round's fix. A proper fix needs `parentStepId` on
  `PipelineStepResponse` (it is not on the wire today), i.e. a wire change — **follow-up ticket
  material**, and worth filing since undo fidelity is a real user-facing promise.
- Round 6's own non-blocking notes (`deleteInternal`'s lowest-position promotion,
  `DemoData.scala:56`'s `nodeStepId = None`, `PatchSetPreviewProjection` echoing the unclamped
  requested position) all still stand unchanged; I re-read each and agree with round 6's
  non-blocking classification.
- Route-level tests for the explicit-`position` and `duplicate` paths now seed flat root siblings, a
  shape real data never has. Coverage is not lost (see item 4 — `:992`, `:1140`, `:1183` cover the
  trunk shapes), but if those flat-sibling fixtures ever drift out of sync with reality they will
  silently stop being meaningful. A comment already says why they exist; no action needed.

### Reproduction artifacts

- Probe spec (deleted from the tree after running): `…/scratchpad/` — source inlined above in item 2.
- Full-suite log: `…/scratchpad/full7.log` (3367/3367, `EXIT=0`).
- Mutation-revert backup: `…/scratchpad/PS.bak` (restored; `git diff --stat` clean).
