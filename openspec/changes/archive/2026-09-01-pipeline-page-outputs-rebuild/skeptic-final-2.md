## Skeptic Report — final gate (round 1, skeptic-final-2.md)

Axis: backend data-integrity and pipeline-structure correctness (dimension-split review).

### Ground truth re-established

- `git log`: HEAD = `649baa21`, tree clean (`git status --porcelain` empty).
- Backend PID 1706240, cwd = this worktree's `backend/`, started 14:32. Last backend-touching
  commit is `03ceb034` at 15:00 — nominally stale, BUT `03ceb034`'s only backend change is a
  type tightening (`attachTailInternal(parentStepId: Option[PipelineStepId])` →
  non-Optional) plus its one call site; the last behavioral backend commit is `72b0fc10`
  (14:30, CR1 leaf-anchor fix), which the running process DOES include. Verified by reading
  `git show 03ceb034 --stat -- backend/` and the diff's own description. Live probes below are
  therefore behaviorally current. `start-servers.sh` reported both servers healthy/reused.
- Gates I re-ran myself: `npx tsc --noEmit -p frontend/tsconfig.json` → exit 0;
  `npx jest --testPathPatterns="features/pipelines"` (from `frontend/`) → **55 suites / 709 tests
  passed**. Green, and — as below — green over the defect I found.

### What I verified (with evidence)

**Backend primitives, read in full (not doc comments):** `spliceInsertAtInternal`,
`attachTailInternal`/`attachTailInternalAction`, `reorderTrunkInternal` +
`validateTrunkReorderRequest`, `deleteInternal`, `positionScopedUpdateAction`,
`insertAtInternal`, `reorderInternal`, `trunkOf`/`tailsOf`/`executionOrder`
(`PipelineStepRepository.scala`), plus `PipelineService.persistNewStep` / `reorderSteps`.

**Specs read for real assertions, not summaries:** `PipelineStepRepositorySpliceSpec.scala`
lines 355-620. The mutation proofs are genuine — each guard is paired with a test that runs
the *opposite* primitive on an identical shape and asserts the guard's assertion is falsified
(`existingChild.parentStepId shouldBe Some(spliced.id)` vs `shouldBe Some(anchor.id)`), and the
reorder suite proves `reorderInternal` is a real no-op for a pure trunk before asserting
`reorderTrunkInternal` permutes. These are not vacuous.

**Live probes against the running backend** (authenticated session, `X-Helio-Requested-With: 1`),
on freshly created pipelines — every claim below is a real `GET /api/pipelines/:id/steps` reading:

1. Tail attach, all four anchor states — all correct:
   - has-trunk-child anchor B: new tail `pos=1`, B's existing `pos=0` child untouched.
   - leaf anchor C: new tail `pos=1` (CR1 fix confirmed live — no position-0 trunk fallback).
   - has-tail anchor: second attach lands `pos=2`.
   - has-both: `pos=2`.
2. Trunk reorder `[C,A,B]` on a trunk with tails on both B and C: relinked to
   `C(ROOT) → A → B`, every trunk node `position=0`, and **both tails travelled with their own
   node** (`T2.parent` still C, `T1.parent` still B). "Tail follows its trunk step" holds live.
3. All three rejection shapes on `PUT /steps/order` return **422** with a specific message and
   leave structure byte-identical (re-read after each): tail id present → "unexpected step ids
   (tail ids are not accepted here...)"; missing trunk id → names the missing id; duplicate →
   "must not contain duplicate step ids". Decision 15 honored.
4. CR2 contract sync: `schemas/pipelines/reorder-pipeline-steps-request.schema.json`,
   `schemas/pipelines/create-pipeline-step-request.schema.json` (`attachAsTail`), and the
   `pipeline-step-reorder` spec delta all describe exactly the behavior I observed live
   (relink + position 0, 422 on the three violations, no partial application). Read against the
   route/service code, not just checked for edits. Correct.

**Frontend handler re-derivation** (I re-ran design.md's own four-step method rather than
trusting its table): `handleInsertStep`, `handleAddStep`, `handleAddTailStep`,
`handleAddOutputViaAggregateTail`, `handleReorderSteps`, `handleToggleStepEnabled`,
`handleDuplicateStep`, `handleRemoveStep`, `useStepCardState.ts:211`, plus the call site the
table omits (`ShapeInstantiateStep.tsx:232`). All check out except one — see below.

### Verdict: REFUTE

One blocking defect, of exactly the CR9/CR10/CR11 class the ticket claims closed, in the one
handler design.md's enumeration table marks `OK` / "No resync needed here".

### Change Requests

1. **`handleInstantiateShape` (`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`
   ~lines 630-690) creates a structurally-dead second tail and renders it as a live trunk card.**

   Path: `PipelineRiverView.tsx:452` sets the shape-picker anchor to
   `stepTree.trunk[stepTree.trunk.length - 1]` — the last TRUNK step. That button is **not**
   gated by `hasTail(...)` (unlike the "+ tail" affordance, which is). `handleInstantiateShape`
   then computes `anchorHasChild` and, when true, creates the shape's first step with
   `attachAsTail: true`.

   Note what `anchorHasChild === true` means for a *trunk-last* anchor: by `buildStepTree`'s own
   definition the trunk ends at a node with no `position === 0` child, so the only way trunk-last
   has a child is that it already has a **tail**. So this arm, whenever it fires, *always*
   attaches a **second** tail — violating the single-tail-per-node Phase-1 invariant the ticket
   enforces everywhere else.

   Reproduced live (fresh pipeline, real backend, `GET /api/pipelines/:id/steps`):
   ```
   trunk A -> B ; tail T attached to B (B is trunk-last)
   shape first step S: POST /steps {parentStepId: B, attachAsTail: true}
     -> d1bfdb7a pos=0 parent=ROOT      (A)
        aee717e3 pos=0 parent=d1bfdb7a  (B)
        21b9e978 pos=1 parent=aee717e3  (T)
        613bf296 pos=2 parent=aee717e3  (S)
   SERVER trunkOf = [A, B]        # S is a position-2 tail; it never executes
   ```
   Client side, `buildStepTree` (`state/stepTree.ts`) takes the `kids.length > 1` branch for B:
   tail = `kids[0]` (T), and `current = kids[kids.length - 1]` = **S**, which is pushed onto the
   **trunk**. So the UI renders `A → B → S…` as the trunk while the backend's trunk ends at B and
   the entire shape chain (and any Output it was added to produce) is silently dead. This is not
   a transient staleness bug that a reload fixes — the server's own `executionOrder` response
   reproduces the same misclassification, so it is **persistent**.

   Compounding it, the handler patches local state with `setSteps((prev) => [...prev, ...])`
   (append at the end of the flat array) and deliberately calls **no** `syncStepsFromServer()`,
   with an in-code comment asserting "No resync needed here". That is the same array-ordering
   hazard `handleAddTailStep` explicitly fixed by splicing at `anchorIndex + 1` (see its own
   comment citing the Cycle-8 live repro).

   Required: (a) do not let this path create a second tail — gate the bottom "Add Outputs from a
   shape" trigger with `hasTail(stepTree, ...)` and/or have `handleInstantiateShape` refuse/
   re-anchor when the anchor already has a tail; (b) insert the new step at the correct flat-array
   index (or simply `await syncStepsFromServer()` after the loop) so local state matches the
   server, and delete the "No resync needed here" comment; (c) add a regression test at the
   `buildStepTree` level asserting that a `position >= 2` sibling is never classified as the trunk
   continuation, and a handler-level test for the trunk-last-has-tail anchor. Note the existing
   709 pipelines tests are all green over this — fixture coverage never exercises this anchor
   state.

   Also update design.md's "complete enumeration as of CR11" row for `handleInstantiateShape`:
   its stated justification ("the only entry that can target a PRE-EXISTING node is the first,
   and it already picks `attachAsTail` correctly") is the wrong hazard question — the hazard here
   is not reparenting, it is that the local patch and the client's trunk/tail derivation disagree
   with the server's, which is step 4 of the method, not step 3.

### Non-blocking notes

- `ShapeInstantiateStep.tsx:232` is a step-mutating `createPipelineStep(` call site with a
  `parentStepId`, live via `PanelCreationModal`, and is absent from design.md's enumeration table
  even though the documented grep would match it. I checked it independently: it builds a chain
  on a brand-new zero-step pipeline (every anchor a fresh leaf) and keeps no rendered step tree,
  so it is safe today. Worth adding to the table so the next auditor does not have to re-derive it.
- `attachTailInternal` will happily create an unbounded number of tails per node (`pos` 2, 3, …);
  the single-tail Phase-1 invariant lives only in the UI. Given CR1 above shows the UI gate is
  already bypassable, consider whether the invariant belongs at the service layer.
- `tailsOf`'s `expand` still follows `childrenOf(...).headOption` (lowest position) rather than
  the explicit `position == 0` rule its sibling functions were corrected to use in HEL-904.
  Pre-existing, not introduced here, but it is the same latent class.
