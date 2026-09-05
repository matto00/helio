## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`, and both prior skeptic reports.
Every render-topology fact below was re-derived from the tree by `cat`/`grep`/`sed`, not taken from the plan's
narrative.

- **Sole call site.** `PipelineRiverView.tsx:292-296` — `nodePathByStepId` `useMemo`,
  `entries[step.id] = nodePath(step.id, steps, roots)`. Confirmed.
- **Three DOM `title=` sites, four threading edges.** `grep -rn "nodePathByStepId"` returns exactly:
  prop decls `LaneColumn.tsx:65,90` / `RootColumn.tsx:47,73`; threading at `LaneColumn.tsx:146`,
  `RootColumn.tsx:114`, `PipelineRiverView.tsx:461`, `PipelineRiverView.tsx:539`; title sites at
  `PipelineRiverView.tsx:381`, `LaneColumn.tsx:171`, `LaneColumn.tsx:216`. design.md's Context is accurate.
- **`RootColumn` cannot reach `LaneColumn.tsx:171`.** `RootColumn.tsx:112` passes `isCompact={false}`
  unconditionally; `LaneColumn.tsx:151`'s `if (isCompact)` early return is the only path to line 171. Round 2's
  CR1 correction is correctly carried into design.md D4 and tasks 1.1/2.4.
- **`extraRoots = roots.slice(1)`** (`PipelineRiverView.tsx:325`, rendered at 510) — root 1 never renders as a
  `RootColumn`; the `--add` pseudo-column shares `pipeline-detail-page__root-column`. Task 1.2's replacement
  probe `getByLabelText("Root: <name>")` matches `RootColumn.tsx:78`'s `aria-label={\`Root: ${root.dataSourceName}\`}`.
  Correct.
- **Labels.** non-compact `aria-label="Lane"` (`LaneColumn.tsx:210`), compact `aria-label="Tail steps"`
  (`LaneColumn.tsx:165`), lane row group `aria-label="Lanes"` (`LaneColumn.tsx:121`, `PipelineRiverView.tsx:435`).
- **`nodePath.ts` read in full.** Base case gated on `rootStepIds.has(currentId) && step.rootId` (line 47);
  fallback `return stepId` at 77 and 89; final `[\`root:${bestRootId}\`, ...trail].join(" > ")` at 92. Mutations
  A and B are well-targeted, and the round-1/round-2 `rootId` and `linkChain` traps are now correctly stated as
  MUSTs in tasks 1.1 (verified `linkChain` at test lines 35-43, `stepA`–`stepD` at 52-80 set no `rootId`,
  `baseProps` hardcodes `roots: ONE_ROOT` + `laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT)`).
- ACs trace to tasks; `skip_specs: true` remains justified (no requirement changes). Mutation discipline
  (discrimination check on A, "a NEW assertion must go red" on B, separate transcripts, revert + full gates)
  is sound and is the strongest part of the plan.
- **`buildLaneGraph` read in full (`state/stepTree.ts:90-230`) — this is where the plan is still short.**

### Verdict: REFUTE

Two defects, both in the fixture/coverage specification rather than in the mutation discipline. Each is the same
class the previous two rounds caught: a fixture rule the plan does not state, whose omission yields a
plausible-looking but wrong shape.

### Change Requests

1. **`tasks.md` 1.1 / `design.md` D4 — the fixture must set `position` explicitly, and the plan never mentions
   `position` at all.** `buildLaneGraph` (`state/stepTree.ts:117-125`) decides trunk-continuation vs.
   branch-into-a-lane purely from `Step.position` (`types/step.ts:43`, optional):
   `continuationIndex = kids.findIndex((k) => k.position === 0)`, with a single fallback — a *sole* child whose
   `position` is `undefined` becomes the continuation. Consequences for a fixture built to tasks 1.1 as written
   (explicit `parentStepId` on every step, `rootId` on the heads, **no positions**):
   - a branch step that is its parent's *only* child becomes a trunk continuation — **no child lane renders at
     all**, so `LaneColumn` and both of its title sites never appear;
   - a parent with two positionless children gets `continuationIndex === -1`, so **both** children seed their own
     lanes and the trunk *terminates at the parent* — not the "trunk continues alongside a branch lane" shape
     tasks 1.1 describes, and it silently shortens the multi-hop chain task 2.3 asserts.
   Note this file's own existing lane fixtures already do it correctly and are the model to copy
   (`PipelineRiverView.test.tsx:353-355, 378-379, 400, 424-425`: continuation child `position: 0`, branch child
   `position: 1`/`2`). State the rule as a third MUST alongside the `rootId` and `linkChain` MUSTs: **the
   continuation child of every branch point carries `position: 0` and each branching child carries
   `position >= 1`.** Task 1.2's "adjust the fixture if the shape differs" is not a substitute — it recovers a
   detectably-absent lane, but not the silently-truncated trunk above.

2. **`tasks.md` 1.1 / 2.4 + `design.md` D4 — the `and/or` licenses skipping edge E4 entirely, contradicting the
   same tasks' "one assertion per edge is required", and mislabels which edge a trunk child lane uses.** A child
   lane hanging off a *trunk* step — compact or not — is rendered from `PipelineRiverView.tsx:461`, i.e. **E2**.
   `LaneColumn.tsx:146` (**E4**) is inside `renderChildLanes`, which is only invoked from within a `LaneColumn`
   (`LaneColumn.tsx:202` compact branch, `:243` non-compact branch) — so E4 renders **only for a lane nested
   under another lane**. tasks 1.1 and 2.4 offer "a ≥2-step child lane off a trunk step, **and/or** a nested lane
   under the compact one — edge E4 … and the non-compact title site `LaneColumn.tsx:216`". Taking the first
   disjunct covers `:216` but leaves E4 uncovered — and E4 is exactly a separately-droppable edge whose removal
   renders `title=undefined` with every gate green, which is HEL-968's defect on a different edge and the reason
   round 2 raised it. Fix by: (a) correcting the edge attribution (trunk child lane = E2 regardless of
   compactness; E4 = nested lane only); (b) replacing the `and/or` with a hard requirement that the fixture
   contain a **lane nested under another lane** (a lane step that itself has a branching child, which per CR1
   also needs `position` set), and a corresponding assertion in 2.4 on a step inside that nested lane.

### Non-blocking notes

- Task 1.2's shape probe will have **multiple** `aria-label="Lane"` elements once root 2's lane and a ≥2-step
  trunk child lane both render, so `getByLabelText("Lane")` throws "found multiple elements". Use
  `getAllByLabelText`, or scope the query. Minor and self-revealing; noting so the executor does not misread it
  as a broken fixture.
- design.md's risk list, D5's exact-string assertions, D3's `closest("[title]")` over `getByTitle`, D6's
  zero-non-test-edit reading of AC6, and the round-1/round-2 corrections all hold unchanged and should survive
  CR1/CR2 as written.
