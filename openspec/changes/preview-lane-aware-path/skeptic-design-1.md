## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

All paths relative to the worktree. Read from source, not from planning prose.

1. **Both defective helpers exist, byte-identical, at the stated sites.** `sed -n '500,510p'` and
   `'660,668p'` of `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`
   show the same `pathToRoot` recursion (parent-only) in `previewStep` and in
   `evaluateNodeRowsForBackfill`. design.md's Context is accurate, including the naming correction
   (`previewStep` / `evaluateNodeRowsForBackfill`, not the ticket's `previewAtNode` / `previewOutputs`).

2. **The 422 mechanism is as claimed.** `InProcessPipelineEngine.scala` pre-walk guard (`byId` built
   *purely* from the passed `steps` vector; `else if (!byId.contains(dep)) Some(LaneReferenceError(...))`).
   `InProcessExecutionBackend.execute` forwards the vector verbatim and re-derives nothing. So a
   missing lane step in the slice is the cause. Ground truth 1 confirmed.

3. **D1 is correct — the engine's notion is a dependency closure, and ordering is genuinely not
   preview's job.** `executeTree`'s `isReady` = `evaluatedIds.contains(parentKey(s)) && laneDep...forall(...)`;
   `loop` selects `ready.minBy(rank)` where `ranks = structuralRank(steps, rootIds, rootIdOfStepStr)`
   is recomputed inside `executeTree` from the vector it is handed. The incoming vector's order is
   therefore only a tiebreak among *already-ready* nodes, and each node's frame depends solely on
   `parentKey` + `laneDep`, both required-evaluated before it runs. Preview imposing an order would be
   inert at best and a drift-prone second authority at worst. **D1 and its corollary: CONFIRMED.**

4. **Over-inclusion is fenced.** tasks 3.4 ("Assert on the closure's membership, not just on rows")
   plus spec-delta scenario "Sibling lanes not referenced by the target are excluded", plus D4's
   run-vs-preview equality with an independently-written literal. The trivially-green non-fix
   ("return every step") fails 3.4. **CONFIRMED.**

5. **Disabled-node reasoning is correct.** `evalNode` returns `currentRows` unchanged for a disabled
   step but the loop still writes `nodeOutcomes(StepKey(id))` and adds it to `evaluatedIds`. So a lane
   reference to a disabled node resolves to its passed-through frame — and *excluding* it from the
   closure would trip the `!byId.contains(dep)` guard. design.md's risk item and task 2.5 are right.
   **CONFIRMED (contract item 9).**

6. **Spec-delta header matches the live spec exactly.** Live `openspec/specs/pipeline-step-preview/spec.md:6`
   and the delta's `### Requirement:` line are the identical string
   (`GET /api/pipelines/:id/steps/:stepId/preview returns sample rows up to a step`). All five live
   scenarios are carried forward in the MODIFIED block. **CONFIRMED.**

7. **The two claims the plan builds on are true.** `PipelineAnalyzeService.analyzeNodes`'s `isReady`
   honours `parentStepId` *and* `laneDependencyOf` — it is genuinely the in-repo model and is not
   affected by this defect. `RuntimeGraphPath.Builder.pathOf` consults `laneDep` for the **target step
   only** (one level), while the scaladoc says "or, transitively, a step in its own chain" — D3's
   report-don't-fix framing is accurate.

8. **Multi-root (HEL-913 R4/R10) — traced, and the plan is silent on it.** `InProcessExecutionBackend.execute`
   loads *every* root in `roots` unconditionally and seeds one `RootKey` frame per root; `previewStep`
   passes the full `roots` vector; `previewStep`/`evaluateNodeRowsForBackfill` both read
   `outcome.nodeOutcomes.get(StepKey(target.id.value))` and fall back to `outcome.rows` only when the
   target is the trunk terminal — so R10's "lowest-positioned root's frame" hazard is already
   neutralised at both sites. Nothing in `validateLaneReference` restricts a lane reference to the
   same root, so a **cross-root closure is legal and reachable**. The design and tasks never state
   this, and there is no fixture for it (task 1.1 is single-root). See CR1.

9. **Constraints are respected by the plan.** No migration (tasks 7.3), no browser (7.4), sibling-owned
   paths fenced (7.5), including the `loadCsvRowsFromBytes`-same-file caveat in design.md.

### Verdict: REFUTE

Two bounded, specification-level gaps. The core diagnosis, D1/D2/D3/D4 and the test shape are sound —
this is not a rewrite, it is two additions to design.md/tasks.md/spec delta.

### Change Requests

1. **State and fence the cross-root closure case (ticket criterion 3/6).**
   A lane reference is validated pipeline-scoped, never root-scoped (`PipelineService.validateLane*`),
   so a closure may legally span two roots. Add to design.md a short decision recording the three facts
   I traced above: (a) `InProcessExecutionBackend.execute` loads and seeds a frame for **every** root in
   `roots` regardless of which roots the slice touches, so both call sites MUST keep passing the full
   `roots` vector — narrowing `roots` to the target's own root (as
   `evaluateNodeRowsForBackfill`'s *root-bound* branch does via `explicitRootId`, `PipelineRunService.scala:640-647`)
   would leave the foreign root's `RootKey` unseeded and make the cross-root lane step permanently
   un-ready, failing with `"Cyclic or unresolved lane reference…"`; (b) the target's rows come from
   `nodeOutcomes(StepKey(target))`, **not** `TreeWalkResult.rows`, which under multi-root is the
   lowest-positioned root's trunk terminal (R10) and is only a fallback here; (c) `explicitRootId` in
   `evaluateNodeRowsForBackfill` governs only the root-bound (`targetStepId.isEmpty`) branch and must
   stay `None`/unused on the step-bound branch this change touches.
   Add a task under §3 asserting a preview of a rejoin whose `secondaryInput` lane sits under a
   **different root** returns 200 with rows equal to the run path's — the negative form (roots
   narrowed) is exactly the plausible wrong implementation this design currently leaves unguarded.

2. **Account for the observable `stepCounts` change.**
   `previewStep` returns `outcome.stepCounts` on the wire (`RunResultResponse`). Today those counts
   cover only the ancestor chain; after the fix a rejoin preview's `stepCounts` will additionally
   contain every step of the referenced lane. That is a wire-visible behaviour change no artifact
   mentions, and criterion 5's parity test only covers lane-free graphs, so nothing would catch it
   being wrong. Either state in design.md that the counts SHALL cover the whole executed closure (my
   reading: correct and desirable — they are per-node counts and the lane nodes really did execute),
   and add it to the spec delta's requirement bullets plus an assertion in task 3.2/3.3; or state
   explicitly that they are filtered back to the target's chain and test that. Do not leave it
   unspecified.

### Non-blocking notes

- design.md D2 leaves the helper's object/method name to the executor but pins the package. Fine —
  but task 2.6 wants the helper unit-tested directly, so it must be at least `private[engine]` (like
  `laneDependencyOf`) with the test in `com.helio.domain.engine`. Worth one clause so the executor
  does not make it `private` and then test it only through the service.
- Task 5.2's "confirm or refute, do not repeat" phrasing on the widening sweep is the right shape and
  matches what I had to do myself to trust ground truth 3.
- design.md's observation that the `LaneReferenceError` message ("does not exist in this pipeline") is
  misleading for a slice is correct, and task 6.2's don't-reword-it ruling is the right call: after the
  fix preview can no longer reach that state, so a reword would be an untested edit to the run path.
