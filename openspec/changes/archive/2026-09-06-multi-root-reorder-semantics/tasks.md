## 1. Establish the defect's mechanism (before any fix)

- [x] 1.1 Add a repository-level spec fixture building a **two-root** pipeline (root R1 with trunk A → B,
      root R2 with trunk X → Y) using the existing multi-root test helpers from HEL-913's specs. Do not
      construct `DbContext(db, db)` — follow the surrounding specs' existing context construction, and do
      not claim RLS coverage this path (privileged `withSystemContext`) does not have.
- [x] 1.2 **Run this before task 2 lands** — the task-2 edit destroys the ability to observe it. Against the
      **unfixed** `reorderTrunkInternal`, call it directly with a cross-root `stepIds`
      permutation and record the observed `root_id` change. This is the reproduction the fence makes
      unreachable over HTTP. Record the observation in `files-modified.md`; this probe is scaffolding and
      is superseded by the task 4 assertions, not shipped as a permanent test asserting broken behaviour.

## 2. Backend — root-aware reorder

- [x] 2.1 In `PipelineStepRepository.reorderTrunkInternal`, derive the current trunk as the **union** of
      `trunkOfRoot(...)` over every root, replacing the root-unaware `trunkOf(steps)`, and **label each step
      with the root whose walk produced it** as the union is built. The head-step `stepId -> rootId` seed for
      `trunkOfRoot` must be read as a `DBIO` inside the same `action`/transaction — do **not** call
      `rootIdsOf`, which returns a `Future` in its own `withSystemContext` and is not composable here.
- [x] 2.2 Partition the requested `orderedTrunkIds` using **task 2.1's per-step root labels**, preserving
      requested relative order within each partition (design.md Decision 2 step 3). Do **not** use an
      `rootIdsOf`-style map as the partition key: it filters `s.rootId.isDefined` and so contains only
      parentless head steps, leaving every non-head trunk step (B, Y in the fixture) with no key at all.
- [x] 2.3 Relink each partition independently: head parentless with **that partition's own root id**, each
      later member's parent its predecessor **within the same partition** with `root_id = NULL`, all
      `position = 0`, one transaction. Never one flat chain across roots (Decision 2's named trap).
- [x] 2.4 **Delete** the `rootId <- firstRootIdAction(pipelineId.value)` line and its use from
      `reorderTrunkInternal`. Do not guard it, do not leave it unreachable (Decision 3).
- [x] 2.5 Update `validateTrunkReorderRequest` and its messages to speak of the union of every root's trunk
      rather than "the pipeline's current trunk"; keep exact-permutation semantics (Decision 4).
- [x] 2.6 Rewrite `reorderTrunkInternal`'s scaladoc: it currently asserts single-root behaviour
      ("`orderedTrunkIds(0).parentStepId` becomes `None`") that is now false across roots.
- [x] 2.7 No inline fully-qualified names in any Scala touched (`CONTRIBUTING.md`).

## 3. Backend — remove the fence

- [x] 3.1 Remove the `roots.size > 1` `ServiceError.BadRequest` branch (and its now-stale HEL-913 comment)
      from `PipelineService.reorderSteps`, plus the `listRootDataSourceIdsInternal` call that exists only
      to feed it. Update the method's scaladoc to the whole-pipeline contract.
- [x] 3.2 Delete or restate any existing test asserting the multi-root 400 — it now asserts removed
      behaviour. Do not leave it skipped.

## 4. Tests — acceptance criteria

- [x] 4.1 **AC1 (restated).** Two-root pipeline, `stepIds: [B, X, A, Y]`: assert R1's trunk becomes B → A
      and R2's becomes X → Y, with parents/`root_id`s checked per step and no step of one root appearing
      in the other's chain.
- [x] 4.2 **AC2 (load-bearing) — `derived-plus-column`, per design.md Decision 7.** Two assertions over a
      two-root pipeline, both direct rather than inferred from a 200/`Right`:
      (a) the **full before/after derived owning-root map** for every step — equality of the whole map, not a
      spot check. The test MUST compute each step's owning root **by walking the parent chain to the parentless ancestor and reading that ancestor's root**, not
      by calling `trunkOfRoot`/the union labelling the implementation uses; calling the production helper
      re-derives the expected value from the source under test and asserts nothing.
      (b) the **head-marker column invariant**: before and after, each root has exactly **one** parentless
      head step, and it carries that root's own id. Do not assert raw column-map equality — V98 makes
      `root_id` a head marker, so that is false on correct code (Decision 7).
- [x] 4.3 **Run the AC2 mutation.** Reintroduce the `firstRootIdAction`-derived head root assignment and
      confirm 4.2(a), the **derived** map, goes **red**; confirm the failure isolates to that change. Under
      the corrected criterion this mutation genuinely can fire — verify it does. If it stays green the test
      is not testing root membership: fix the test, never weaken it. Record the red output verbatim in
      `files-modified.md`, then revert the mutation.
- [x] 4.4 Single-root regression: an existing-shape reorder behaves exactly as before (spec delta's
      single-root scenario).
- [x] 4.5 Rejection paths still hold and change nothing: tail id present, duplicate, unknown id, and the
      new partial-payload case (one root's trunk omitted on a two-root pipeline) — each 422 with every
      `position`, `parentStepId` **and** `root_id` unchanged. (Raw column equality IS the right assertion
      here, unlike 4.2: a rejected request writes nothing at all.)
- [x] 4.6 Confirm each new red arm can actually fire before treating it as evidence; two mutations that
      produce the same observation are one axis, not two. No test may re-derive its expected value from
      the same helper the implementation uses.

## 5. Schema

- [x] 5.1 Rewrite `schemas/pipelines/reorder-pipeline-steps-request.schema.json`'s `description`: it is
      singular-root ("the position-0 chain from the root", "the pipeline's TRUNK") and is now wrong in a
      second way, since relinking is per-root rather than one chain. State the union contract, the
      interleaving-carries-no-meaning rule, and root-membership invariance. Shape is unchanged (no
      `rootId` property).
- [x] 5.2 `npm run check:schemas` green.
- [x] 5.3 Update `PipelineStepProtocol.ReorderPipelineStepsRequest`'s scaladoc to match (shape unchanged).

## 6. Frontend

- [x] 6.1 In `usePipelineDetailPage.handleReorderSteps`, build the payload from **exactly one lane per
      root** — for each root, the lane seeded by that root's `position == 0` root-level step (generalise the
      existing `.find(l => l.parentStepId === undefined && l.rootId === r.id)` over `roots` instead of
      `roots[0]`). NOT a `filter`-style "every root-level lane": `buildLaneGraph` seeds one lane per
      root-level step and a root may have several, the extra ones being tail roots, whose ids the endpoint
      rejects ("tail ids are not accepted here") — that reading would 422. Preserve the existing temp-id (`step-N`)
      exclusion, optimistic update, by-id reconciliation and revert-on-failure. Remove the stale
      "reorder is still root-0-only ... HEL-973" comment.
- [x] 6.2 A test covering a two-root pipeline whose fixture **includes a tail** on at least one root: assert
      the persisted payload is exactly the two roots' trunk ids and contains no tail id, so 6.1's wrong
      reading is caught rather than merely avoided.
- [x] 6.3 No visual/interaction change intended; do not touch HEL-590's dashboard frontend files.

## 7. Gates

- [x] 7.1 `sbt test` (backend), `npm test`, `npm run lint`, `npm run typecheck`, `npm run check:schemas`.
- [x] 7.2 Show **zero** `firstRootIdAction` hits within `reorderTrunkInternal`'s body, using a
      **body-scoped extraction** (e.g. `sed -n '<start>,<end>p'` over the method range in
      `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
      piped to `grep`), NOT a whole-file `grep -rn` — the file legitimately retains other call sites
      (~:44, :100, :283, :396, :469) plus a namesake in `OutputRepository`, all out of scope, so a
      whole-file grep's non-zero output would look like a failed proof — proof by absence, per AC3. Record the command and output.
- [x] 7.3 Write `files-modified.md` (every file touched, the task-1.2 reproduction, the task-4.3 mutation
      transcript, and the task-7.2 grep).
