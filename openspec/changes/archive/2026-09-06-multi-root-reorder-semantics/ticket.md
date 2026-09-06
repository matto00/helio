# HEL-973: Define reorder semantics for multi-root pipelines (PUT /api/pipelines/:id/steps/order)

## Description

HEL-913 (P2.3) makes a pipeline own several source roots. `PUT /api/pipelines/:id/steps/order` was written when a pipeline had exactly one root, and its semantics do not survive that change. HEL-913 ships the route **failing closed** on a multi-root pipeline (a named 400 in `PipelineService.reorderSteps`), because leaving it reachable would have been a silent cross-root corruption. This ticket defines what it should actually do, and replaces the fence with real behaviour.

### The defect HEL-913 fenced off

In `PipelineStepRepository.reorderTrunkInternal`:

- `currentTrunk = trunkOf(steps)` is **root-unaware** — it picks the first `position == 0` child at each level across the whole pipeline, so on a multi-root pipeline "the trunk" spans roots.
- `rootId <- firstRootIdAction(pipelineId)` always resolves the **lowest-positioned** root.
- The `idx == 0` step is then written with `root_id = <that lowest root>`.

So reordering a multi-root pipeline could take a step belonging to root B's trunk and **silently reassign it to root A** — a step moving between roots with no error. This is the "resolves *the* root without saying *which* root" defect class HEL-913 found six instances of.

## The ruling (owner decision, final)

The ticket presented two options and asked for a deliberate decision. **The owner has ruled: option 2, whole-pipeline reorder** — roots interleaved by position, with `ReorderPipelineStepsRequest` keeping its current shape (`stepIds` only, **no** `rootId` field). This went against the ticket's own stated lean toward option 1. It is not to be re-litigated. It may only be reopened on demonstrated evidence that whole-pipeline reorder is not implementable without violating an invariant — a contradiction shown, never a preference argued.

### The constraint that makes the ruling safe

Whole-pipeline semantics means a single `stepIds` list legitimately contains steps belonging to **different roots** — exactly the input shape HEL-913 fenced off. The central design obligation is therefore:

> **Root membership must be invariant under reorder, by construction rather than by convention.** A step's `root_id` after the call must equal its `root_id` before the call, for every step, always. Reorder permutes *position*; it must never move a step between roots.

Both mechanisms named above are still defects under this ruling and must both go. Per HEL-913 task 7.3d's rule — an arm that is reachable is a defect, not debt — the `firstRootIdAction` fallback is **removed** from `reorderTrunkInternal`, not bypassed, guarded, or retained "just in case".

## Scope

- Implement whole-pipeline reorder semantics with root membership invariant.
- Replace HEL-913's fail-closed 400 with real behaviour.
- Update `schemas/pipelines/reorder-pipeline-steps-request.schema.json`: its description is singular-root (HEL-913 already flagged this) and is now wrong in a second way under whole-pipeline semantics. Fix the prose as well as any shape change. Keep `check:schemas` green.
- Make `reorderTrunkInternal` root-aware.
- Frontend reorder affordance **only if** the chosen semantics require a change. Coordinate nothing with HEL-968 — it is already merged.
- Do not touch files owned by the concurrent HEL-590 (share tokens / ACL path, dashboard frontend) or HEL-890 (secondary-source truncation) runs. If the change appears to require it, stop and escalate rather than racing.

## Acceptance criteria

- [ ] **AC1 (restated — see below).** On a two-root pipeline, a whole-pipeline reorder applies each root's requested relative order to that root's own trunk, and a step of root B never lands in root A's chain.
- [ ] **AC2 (load-bearing — corrected, see below).** No step changes the root it belongs to as a side effect of a reorder, asserted **directly** on a two-root pipeline and not inferred from a successful call, as two assertions: (a) the **full before/after derived owning-root map** for every step — each step labelled by the root whose trunk chain it is reachable on, computed by the test from the parent chain independently of the production helper; and (b) the **head-marker column invariant** — before and after, each root has exactly one parentless head step carrying that root's own id.
- [ ] The `firstRootIdAction` fallback is **gone** from `reorderTrunkInternal`, not merely bypassed. Proven by absence: grep the symbol and show zero hits in that path.
- [ ] `check:schemas` green with the updated request schema.

### Note on AC1: superseded and restated

The ticket's original AC1 read *"Reordering one root's trunk on a two-root pipeline reorders only that root's steps."* That criterion was written for **option 1 (per-root reorder)** and does not describe the ruled semantics: under whole-pipeline reorder there is no per-root call to make, so "reordering one root's trunk" is not an operation the API offers. It has therefore been **restated** above for whole-pipeline semantics, preserving its actual protective intent (a reorder must not disturb the other root's membership).

This restatement is deliberate and must be stated explicitly in `design.md`, with this reasoning. The original criterion must be neither silently satisfied under its old wording nor silently dropped.

### Note on AC2: corrected (factual error, owner-answered)

AC2 was briefed as *"no step changes its `root_id` … assert the full before/after `root_id` map"*, on the belief that `root_id` is a membership label. `V98__pipeline_roots.sql`'s `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` makes it a **head marker** instead — non-null on exactly the one parentless head per root. On this ticket's own fixture, correct code moves the marker (`A.root_id: R1 → NULL`, `B.root_id: NULL → R1`) while membership is fully preserved, so a literal column-map assertion is red on correct code and its mutation could never fire from green.

This was escalated rather than restated unilaterally; `escalation.answered` = `derived-plus-column`. It is a correction of a factual error in the criterion, **not** a weakening or a preference change: the column assertion is kept (as the invariant that actually holds) precisely because the column is where the original corruption manifested.

## Dependencies

Blocked by HEL-913 (merged), which fences the route and records the analysis (task 7.3d-i). Related to HEL-968 (merged). This is the last open child of HEL-903 — delivering it closes the epic.
