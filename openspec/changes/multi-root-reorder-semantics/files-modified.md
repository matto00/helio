# Files modified — HEL-973

## Cycle 2 (evaluation-1.md change requests)

- `frontend/src/features/pipelines/state/stepTree.ts` — **CR1 fix.** `reorderLane`'s relink now moves `rootId` onto the new head (`i === 0`) of a ROOT lane (`lane.parentStepId === undefined`), and clears it from every other member — mirroring the backend's V98 head-marker semantics (parentless iff root-id-bearing). Before this fix, moving a non-head step into the head slot produced a parentless-AND-rootless step, which `buildLaneGraph` dropped into `unassignedRootLevel`; with another root's head still present, the `rootStepsByRootId.size === 0` rescue never fired, so the whole root (including any root-level tail) was silently swept into another root's payload by the totality sweep. This was the evaluator's live repro (`PUT /steps/order` 422 with a tail id in the payload).
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — **CR2 fix.** `handleReorderSteps` now computes each root's post-reorder trunk lane and compares it against whether that root demonstrably had steps before the reorder (via a `previousGraph` built from `previousOrder`); if a root's trunk lane comes back empty despite having had steps, the handler refuses (error toast, no optimistic mutation applied, no network call) instead of silently contributing an empty/truncated payload for that root. This check runs before the optimistic `setSteps` and before the try/catch, so a refusal never needs to revert anything. Defense-in-depth: with CR1's fix in place this exact path is not reachable by the evaluator's fixture (a root-level tail happens to occupy the "trunk lane" slot instead of coming back truly empty), but it directly implements CR2's literal ask ("do not send a payload derived from a root whose lane came back empty while that root demonstrably has steps") and guards a future regression of the same shape.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — **CR3.** Added a new test moving a root's *second* trunk step into the head slot on a two-root pipeline with a root-level tail, asserting the persisted payload is exactly both roots' trunk ids with no tail id. Confirmed red against the pre-CR1-fix `stepTree.ts` (payload was `["tail1","b1","a1","x1"]` — the tail absorbed the whole orphaned root), then green after the CR1 fix. Transcript below.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` — **non-blocking suggestion.** In the AC2 test, `ownershipAfter shouldBe ownershipBefore` (axis a) now runs immediately after computing `ownershipAfter`, before `headMarkerMap`/`headsAfter` (axis b) is even computed — so each axis's red is independently observable rather than axis (b)'s head-count check masking whether axis (a) ever actually fired. Re-ran the task 4.3 mutation; transcript below shows axis (a)'s own map-equality assertion firing directly.

### CR1/CR3 verification — frontend head-move fix

Against the pre-fix `stepTree.ts` (git `HEAD` version, `reorderLane` untouched), the new CR3 test:

```
FAIL src/features/pipelines/ui/PipelineDetailPage.test.tsx
  ● PipelineDetailPage › reorder (HEL-407) › on a two-root pipeline with a tail, moving a root's SECOND trunk step into the head slot still produces exactly both roots' trunk ids with no tail id

    expect(received).not.toContain(expected) // indexOf
    Expected value: not "tail1"
    Received array:     ["tail1", "b1", "a1", "x1"]
```

Restoring the CR1-fixed `stepTree.ts` and re-running:

```
Test Suites: 1 passed, 1 total
Tests:       119 skipped, 1 passed, 120 total
```

### Non-blocking suggestion verification — AC2 axis (a) independently red

Re-ran the task 4.3 mutation (reintroduce `firstRootIdAction`-derived head assignment for every partition head) against the reordered AC2 assertions:

```
[info] - should AC2 (load-bearing, derived-plus-column): no step changes its owning root as a side effect, and each root keeps exactly one head *** FAILED ***
[info]   Map(PipelineStepId("e87644db-...") -> PipelineRootId("7c5e97fc-..."), PipelineStepId("d9181f63-...") -> PipelineRootId("7c5e97fc-..."), PipelineStepId("b840926e-...") -> PipelineRootId("7c5e97fc-..."), PipelineStepId("c7560383-...") -> PipelineRootId("7c5e97fc-...")) was not equal to Map(PipelineStepId("c7560383-...") -> PipelineRootId("7c5e97fc-..."), PipelineStepId("b840926e-...") -> PipelineRootId("7c5e97fc-..."), PipelineStepId("e87644db-...") -> PipelineRootId("ac088c14-..."), PipelineStepId("d9181f63-...") -> PipelineRootId("ac088c14-...")) (PipelineStepRepositorySpliceSpec.scala:721)
```

The failure now comes directly from the `ownershipAfter shouldBe ownershipBefore` map-equality assertion (line 721, axis a) — a full map with all four step ids mapped to the wrong (single, merged) root — not from `headMarkerMap`'s internal head-count check. Mutation reverted; full spec re-run green (28/28).


- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — `reorderTrunkInternal` made root-aware (design.md Decision 2): derives the union of every root's trunk via `trunkOfRoot`, labels each step with the root whose walk produced it (reading the head-step seed map as a `DBIO` inside the same transaction, not via `rootIdsOf`), partitions `orderedTrunkIds` by that per-step label, and relinks each partition independently (its own head parentless carrying its own root id, later members chained within the same partition, `root_id = NULL`). `firstRootIdAction` deleted from this method entirely (Decision 3) — proof by absence below. `validateTrunkReorderRequest` and the method's scaladoc updated to the union-of-every-root's-trunk contract.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `reorderSteps`: removed HEL-913's `roots.size > 1` fail-closed 400 branch and its now-stale comment, plus the `listRootDataSourceIdsInternal` call that existed only to feed it. Scaladoc updated to the whole-pipeline contract.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — `ReorderPipelineStepsRequest` scaladoc rewritten for the union-of-every-root's-trunk contract (shape unchanged, no `rootId` field).
- `schemas/pipelines/reorder-pipeline-steps-request.schema.json` — `description` rewritten: union-of-every-root's-trunk contract, interleaving-carries-no-meaning rule, root-membership invariance. Shape unchanged. `check:schemas` verified green (see gate output below).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` — added a `"reorderTrunkInternal on a two-root pipeline (HEL-973)"` block: AC1 (restated) two-root relink test, AC2 (load-bearing, `derived-plus-column`) before/after derived-owning-root-map + head-marker-column-invariant test, single-root regression, and a partial-payload-omitting-a-root 422 test. Added `addSecondRoot`, `owningRootMap` (walks `parentStepId` independently of `trunkOfRoot`/`rootIdsOf`, reading the raw `root_id` column by direct SQL), `headMarkerMap`, and `rawRootIdColumn` test helpers.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — restated the HEL-913 "returns 400 once the pipeline has more than one root" test (now-removed behaviour) as a genuine end-to-end two-root reorder success test through the live route, asserting each root's own relink and membership invariance. Added `seedRootStepForRoot` helper (like `seedRootStep`, but for a non-default root — `seedRootStep` hardcodes `root_id = pipeline_id`, which only holds for `seedPipeline`'s own root 0). Both root-1 steps are created via the live `POST` route *before* the second root is added (a plain `POST` with neither `parentStepId` nor `rootId` correctly 400s once a pipeline has more than one root — a pre-existing, unrelated contract this file already covers).
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — `handleReorderSteps`'s payload construction generalized from root-0-only (HEL-968's stopgap) to exactly one lane per root: for each root, the lane seeded by that root's own `position == 0` root-level step. Not a filter over every root-level lane (which would include tail roots and 422).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added a task 6.2 test: two-root pipeline, one root has a three-step trunk plus a root-level tail; asserts the persisted payload is exactly both roots' trunk ids with no tail id. Confirmed (scaffolding, reverted) that the "filter over every root-level lane" wrong reading makes this test fail red (see mutation transcript below).

## Task 1.2 — reproduction of the fenced defect (pre-fix)

Per task 1.2, before landing the task-2 fix, `PipelineStepRepository.scala` was temporarily reverted to its pre-HEL-973 (HEL-913-fenced) state and a scaffolding spec (`Hel973ReproSpec.scala`, deleted after capturing this transcript) called `reorderTrunkInternal` directly on a two-root fixture — bypassing the HTTP-level 400 fence, which only lives in `PipelineService`, not the repository. Root 2's trunk (X → Y) was inserted *before* root 1's own trunk (A) so the root-unaware `trunkOf`'s `childrenOf(steps, None).find(_.position == 0)` (a stable sort over position ties) picks X's chain as "the" trunk. Reordering `Seq(y.id, x.id)` — a valid permutation of that (wrong) trunk — writes `root_id = firstRootIdAction` (root 1, the lowest-positioned root) onto `y`, unconditionally, even though `y`'s actual owning root is root 2.

Observed output (test run against the unfixed repository):

```
[HEL-973 repro] before: x.root_id=Some(12c648b6-e039-4725-ac36-d28050d400ff) (expected Some(12c648b6-e039-4725-ac36-d28050d400ff)), a.root_id=Some(844b1381-9cea-4a28-8a77-06a2809097ea) (expected Some(844b1381-9cea-4a28-8a77-06a2809097ea))
[HEL-973 repro] reorderTrunkInternal result = Right(Vector(SelectStep(PipelineStepId(1688316a-173d-44a4-a2f4-4b48bc872956),...,None,true), SelectStep(PipelineStepId(c16f9c9d-...),...,None,true), SelectStep(PipelineStepId(eff987f5-...),...,Some(PipelineStepId(c16f9c9d-...)),true)))
[HEL-973 repro] AFTER: y.root_id=Some(844b1381-9cea-4a28-8a77-06a2809097ea) -- root2 was 12c648b6-e039-4725-ac36-d28050d400ff, root1 (firstRootIdAction's unconditional pick) was 844b1381-9cea-4a28-8a77-06a2809097ea
[info] - should silently reassigns a step from root 2's trunk onto root 1 (the fenced defect)
[info] Tests: succeeded 1, failed 0, canceled 0, ignored 0, pending 0
```

`y.root_id` moved from root 2's id to root 1's id — the exact silent cross-root reassignment the ticket describes. The repository file was then restored to the fixed (post-task-2) version and the scaffolding spec deleted; this transcript is its only remaining record, per task 1.2's instruction that it is scaffolding, superseded by the task 4 AC1/AC2 assertions.

## Task 4.3 — AC2 mutation (reintroduce `firstRootIdAction`-derived head assignment)

The fix's partition-head root assignment (`Some(rootId.value)`, the partition's *own* root) was temporarily replaced with `Some(mutatedRootId)` where `mutatedRootId <- firstRootIdAction(pipelineId.value)` — i.e. every partition's head unconditionally gets the pipeline's lowest-positioned root, reintroducing the original defect's mechanism. Re-running `PipelineStepRepositorySpliceSpec`:

```
[info] reorderTrunkInternal on a two-root pipeline (HEL-973)
[info] - should AC1 (restated): applies each root's requested relative order within that root, never merging a step of one root into the other's chain *** FAILED ***
[info]   Vector(PipelineStepId("e68d6b85-...")) was not equal to Vector(PipelineStepId("48f05cb0-...")) (PipelineStepRepositorySpliceSpec.scala:689)
[info] - should AC2 (load-bearing, derived-plus-column): no step changes its owning root as a side effect, and each root keeps exactly one head *** FAILED ***
[info]   root 8f26e2ff-3767-4a99-94aa-fe303998ad2f must have exactly one parentless head: 2 was not equal to 1 (PipelineStepRepositorySpliceSpec.scala:670)
[info] - should single-root pipeline is unaffected by the widened union contract (regression)
[info] - should rejects a payload omitting another root's trunk on a two-root pipeline (422), writing nothing
[info] Tests: succeeded 26, failed 2, canceled 0, ignored 0, pending 0
```

Both AC1 and the load-bearing AC2 (derived owning-root map, and the head-marker count) go red, isolated to exactly the mutated lines. The mutation was then reverted and the full spec re-run green (28/28, see below). This confirms the corrected `derived-plus-column` criterion (design.md Decision 7) genuinely can fire, unlike the originally-briefed raw column-map wording.

## Task 6.2 — frontend mutation (filter over every root-level lane)

`handleReorderSteps`'s per-root trunk-lane lookup was temporarily replaced with a flat `reorderedGraph.lanes.filter(l => l.parentStepId === undefined).flatMap(...)` — the wrong reading task 6.1 names explicitly (every root-level lane, not just each root's trunk lane). Re-running the new PipelineDetailPage.test.tsx test:

```
FAIL src/features/pipelines/ui/PipelineDetailPage.test.tsx
  ● PipelineDetailPage › reorder (HEL-407) › on a two-root pipeline whose one root has a tail, the persisted payload is exactly the two roots' trunk ids and contains no tail id

    expect(received).not.toContain(expected) // indexOf
    Expected value: not "tail1"
    Received array:     ["a1", "c1", "b1", "tail1", "x1"]
```

Goes red, including the tail id it must exclude. Mutation reverted; the test passes green on the correct implementation (see `npm test` output in the gate results).

## Task 7.2 — proof of absence: `firstRootIdAction` is gone from `reorderTrunkInternal`

Method-body-scoped extraction (not a whole-file grep, which legitimately still finds `firstRootIdAction` at its own definition and at unrelated call sites — `:44` (def), `:100`, `:283`, `:396`, `:469` — all out of scope):

```
$ grep -n "def reorderTrunkInternal" backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala
641:  def reorderTrunkInternal(pipelineId: PipelineId, orderedTrunkIds: Seq[PipelineStepId]): Future[Either[String, Vector[PipelineStep]]] = {

$ sed -n '641,685p' backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala | grep -n "firstRootIdAction"
(no output, exit code 1)
```

(Method body runs 641–685 inclusive; line 686 is the closing `ctx.withSystemContext(...)`, line 688 begins `validateTrunkReorderRequest`.) Zero hits within `reorderTrunkInternal`'s own body.
