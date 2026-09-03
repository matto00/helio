# Tasks

## 1. Lane graph (replaces the trunk/tail model)

- [x] 1.1 In `frontend/src/features/pipelines/state/stepTree.ts`, replace `buildStepTree` with
  `buildLaneGraph(steps: Step[]): LaneGraph`, where `LaneGraph = { lanes: Lane[]; laneOfStepId:
  Record<string,string>; primaryLaneId: string | undefined }` and `Lane = { id: string; parentStepId:
  string | undefined; steps: Step[]; depth: number }`. The position-0 chain from the root is the PRIMARY
  lane, rendered at top level; only a node's position >= 1 children root lanes (Decision 1, as ruled
  mid-run — an earlier draft said "every step child roots its own lane" and is repudiated). A lane
  continues through single-child edges. Delete `tailsByStepId` and `hasTail` (design Decision 1) — no shim.
- [x] 1.2 Preserve totality: every input step appears in exactly one lane, including a parentless
  in-flight step and orphaned data. Assert `sum(lane.steps.length) === steps.length` in a test.
- [x] 1.3 Replace `reorderTrunk` with `reorderLane(graph, laneId, fromIndex, toIndex): Step[]`, keeping the
  existing `parentStepId` relinking (the client mirror of `reorderTrunkInternal`) but scoped to one lane, and
  keeping the executionOrder-shaped re-flatten. Reordering one lane must not change any other lane's steps.
- [x] 1.4 Rewrite `state/stepTree.test.ts` for the lane properties. Each new test must be verified to FAIL
  against the pre-change grouping — record the observed failure per test in `files-modified.md`. A test that
  only asserts the call returned is not coverage (lesson 8): assert the produced lane membership and order.

## 2. Deterministic layout

- [x] 2.1 New `frontend/src/features/pipelines/state/laneLayout.ts`: `computeLaneLayout(graph): { slotOfStepId:
  Record<string,{lane:number;row:number}>; laneCount: number; rejoinEdges: Record<string,string[]> }`. Pure and
  synchronous. Column order = ascending sibling `position`, array order as tiebreak (engine contract item 4).
- [x] 2.2 A rejoin (a step whose config carries `secondaryInput.kind === "lane"`) is placed at
  `max(row of every consumed node) + 1`, in the lane of its parent edge; `rejoinEdges[stepId]` lists every
  consumed node id. Must handle a node consumed by SEVERAL rejoins and a rejoin naming a NON-terminal node
  (engine contract item 6) — neither may be dropped, deduplicated, or reported invalid.
- [x] 2.3 New `state/laneLayout.test.ts`: determinism (same input twice, deep-equal output); three siblings
  get three distinct adjacent columns in position order; a pure chain is one lane with monotonic rows; the
  diamond case (one lane feeding two rejoins); a rejoin on a non-terminal node.

## 3. River rendering

- [x] 3.1 New `ui/LaneColumn.tsx`: renders one lane as a vertical mini-river of `StepCard`s with its own
  Outputs rail. `TailChain`'s compact indented dashed rendering survives as a branch of this component
  (a one-step lane whose steps carry Outputs), so tails render unchanged. Retire `ui/TailChain.tsx`.
- [x] 3.2 Rewrite `ui/PipelineRiverView.tsx` to render lanes side by side on the column grid from task 2,
  drawing a spanning connector from each consumed lane into a rejoin's single column. Keep the existing
  `useRef`-based stable-callback pattern and `EMPTY_*` stable-reference precedents (they exist for
  `StepCard`'s `React.memo`). Keep this file and `LaneColumn.tsx` under the ~400-line guidance.
- [x] 3.3 Guard tail rendering EXPLICITLY. There are no Jest snapshots anywhere in the frontend, and the
  only tail-referencing tests in `PipelineRiverView.test.tsx` (:320-334) are the `trunkLastHasTail` gate
  tests task 4.1 deletes — so "tails render identically to P1.5" is currently UNGUARDED and AC2's wording
  points at an artifact that does not exist. Write a new assertion pinning the two properties
  `pipeline-tails-ui` actually states: the indented dashed-connector chain, and its termination in the
  step's Output chip. State in `files-modified.md` that this is a GUARD, not a proof of pixel identity, and
  show it failable by mutating `LaneColumn`'s compact branch alone (one mutation, not a conjunction —
  lesson 5). If any pre-existing tail assertion needs editing, STOP and state why before changing it
  (lesson 1).
- [x] 3.4 Per-node analyze schema, validation errors, and inline previews render on steps in every lane
  (not just the primary lane).

- [x] 3.5 LIVE Playwright blast radius — exactly ONE running spec, not twenty.
  - `e2e/hel908-trunk-reorder-drag.spec.ts` (`:110,116,206,209,226`) locates
    `.pipeline-detail-page__tail-chain-item`, emitted by the `ui/TailChain.tsx` task 3.1 retires. This is the
    ONLY e2e guard of that DOM contract that actually runs (`playwright.config.ts:62-63` records it passing
    both CI runs), and therefore the entirety of the machine-checkable AC2 guard this design leans on.
  - `LaneColumn`'s compact branch MUST preserve the `.pipeline-detail-page__tail-chain-item` class and its
    nesting. That contract is the only machine-checkable expression of AC2 that exists (there are no
    frontend snapshots). If these five locators still pass UNCHANGED, that is the evidence; if they need
    editing, that is a defect symptom to explain first (lesson 1).
- [x] 3.6 `e2e/hel908-tail-attach.spec.ts` is QUARANTINED and is NOT blast radius. It sits in `testIgnore`
  at `playwright.config.ts:47` (HEL-962) — the single exclusion list for both `npm run e2e` and CI's glob
  job — so it is collected by NOTHING. Any edit to it is documentation, not verification, and MUST NOT be
  cited as blast-radius coverage or as evidence for any AC (lesson 4, one step worse: this gate is not even
  collected). Its `"Add tail step"` locators (`:76,79,171,245,343`) are NOT broken by this change's rename:
  `grep -rn "Add tail step" frontend/` returns nothing today, because the affordance is already labelled
  "Branch" (`PipelineRiverView.tsx:415-421`) — that IS the HEL-962 quarantine reason, a pre-existing defect.
  DECISION for this cycle: leave the file to HEL-962, untouched. Do not edit it, and do not fold a
  pre-existing defect into this change's diff under the rename narrative.

## 4. "+ lane" affordance

- [x] 4.1 Replace the "Branch" button's `!stepTree.tailsByStepId[step.id]` gate with an unconditional
  "+ lane" affordance on every step. Delete the refusal message and the `trunkLastHasTail` disable on the
  shape-picker button (`PipelineRiverView.tsx:309-311`) — the invariant behind both is gone.
- [x] 4.2 Update `hooks/usePipelineDetailPage.ts`: `handleAddTailStep` becomes `handleAddLaneStep`;
  add/insert/reorder handlers reason in lane-relative rather than trunk-relative indices; the `hasTail`
  prop threading into `StepCard` is removed.
- [x] 4.3 Jest: adding a second and a third lane to the same step each succeed and render; no refusal
  message appears.

## 5. Rejoin picker ("other lane")

- [x] 5.1 Change `UnionConfigValue` (declared in `ui/stepConfigs/UnionConfig.tsx:18`) and
  `LookupConfigValue` (`ui/stepConfigs/LookupConfig.tsx:23`) — NOT in `stepNarrowing.ts`, which only
  imports them — from a flat
  `otherDataSourceId`/`referenceDataSourceId` string to a discriminated
  `secondary: {kind:"source";dataSourceId:string} | {kind:"lane";stepId:string}`. Delete the
  "degrade lane-kind to empty string" branches at `stepNarrowing.ts:502-509` and `:522-527` — they silently
  DISCARD a stored lane reference on any subsequent edit.
- [x] 5.1a Expect FOUR test files in this shape change's blast radius, not two — all construct the flat
  narrowed shape and will fail `typecheck`: `ui/stepConfigs/UnionConfig.test.tsx`,
  `ui/stepConfigs/LookupConfig.test.tsx`, `state/stepNarrowing.test.ts` (`:35,47,60,68,94,112`), and
  `hooks/useStepCardState.test.ts` (`:193,208,218,241`). State why each changed in `files-modified.md`
  (lesson 1).
- [x] 5.1b `stepNarrowing.test.ts:60` PINS the degrade-to-`""` data-loss behaviour task 5.1 deletes
  (`expect(unionConfigOf(step)).toEqual({ otherDataSourceId: "", mode: "byPosition" })`). REPLACE it with
  the task 5.6 round-trip assertion — do NOT merely retype it to the new shape, which would re-pin the
  defect in new clothes. Call this out explicitly in `files-modified.md`.
- [x] 5.2 In `hooks/useStepCardState.ts`, widen the discriminated arm straight through in `onUnionChange`
  and `onLookupChange` (replacing the unconditional `{kind:"source"}` at `:367-381`).
- [x] 5.3 New `ui/stepConfigs/SecondaryInputPicker.tsx`, used by `UnionConfig.tsx` and `LookupConfig.tsx`:
  a data-source option group plus an "other lane" option group listing pipeline nodes.
- [x] 5.4 Eligibility, as a PROPERTY not a name list (lesson 6): offer every node except the configuring
  step itself; disable ONLY the step's own ancestors, each with a visible cycle reason. Ancestry is computed
  over parent edges AND existing lane edges (a lane edge is a real DAG edge). Do NOT implement a
  terminal-only filter, a single-consumer filter, or any left-of/above-of ordering filter — engine contract
  items 6 and 6b state the engine permits all three shapes, and 6b names this exact mistake.
- [x] 5.5 Jest: an ancestor is listed-but-disabled with a reason; the step itself is absent; a non-terminal
  node, an already-consumed node, a node in a higher-index lane, and a node at a lower row are each
  SELECTABLE. Assert on the produced option list and its disabled/reason state, not that render succeeded.
- [x] 5.6 Jest: a stored `{kind:"lane", stepId}` config round-trips — it loads showing that node selected,
  and re-saving an unrelated field on the same step preserves the lane reference. Verify this test fails
  against the pre-change narrowing (it is the data-loss branch task 5.1 deletes).

## 6. Lane-aware Outputs and run reporting

- [x] 6.1 `ui/OutputGalleryCard.tsx` / `ui/OutputsGalleryTab.tsx`: the "off `<step>`" subtitle gains a
  `›`-separated lane segment for a non-primary lane (`off filter › lane 2 › aggregate`); a primary-lane
  Output's subtitle is unchanged. Build the path from the lane graph, not a second traversal.
- [x] 6.2 SSE row counts render per node across all lanes (thread `runStepRowCounts` into every
  `LaneColumn`, not only the primary lane).
- [x] 6.3 DEFERRED, deliberately — do NOT implement a failing-node lane-path highlight, and do NOT derive
  one client-side from `stepRowCounts`. There is no lane-path field on the wire: HEL-911 checked its task
  8.2 and synced `openspec/specs/pipeline-run-execution/spec.md:9` to assert a SHALL with an exact format,
  but shipped nothing (`grep -rn "lanePath" backend/src/main/scala` => 0). A client-side derivation would
  silently mis-highlight a disabled node, which reports no row count by contract item 9. Escalated and
  answered `defer-to-followup`; the field and format are routed to HEL-913. Per-lane row counts (6.2) are
  unaffected. The PR body must state this as a real gap in HEL-911, not as a scope choice.

## 7. Mobile

- [x] 7.1 CSS-only: the lane container is a flex row that becomes a column below the existing phone
  breakpoint, revealing a per-lane header that is hidden at desktop widths. Tokens only, per `DESIGN.md`.
- [x] 7.2 Reuse the existing `tap-expand-44` utility for every new control; do not re-implement the floor.
- [x] 7.3 Verify the ≥44px floor at 375px and 430px via the existing mobile touch-target sweep, AND verify
  lane STACKING separately in the Playwright spec (task 8.1) at both widths. These need two different
  mechanisms and must not be conflated: the sweep is a set of `*.css.test.ts` files that parse CSS, NOT a
  viewport render, so it cannot demonstrate that lanes stack — citing it for stacking would be exactly the
  "green gate that scans nothing" shape (lesson 4). Confirm what the sweep actually scans and that it is
  invoked as CI invokes it before citing it for the floor either.

## 8. End-to-end

- [x] 8.1 New `e2e/hel912-lanes-rejoin.spec.ts`, following the existing `hel908-*.spec.ts` conventions:
  add a lane off a filter, add an aggregate in each lane, rejoin with `union` selecting the other lane, add
  a table Output on the rejoin, dry-run, assert per-lane row counts render and the Output thumbnail renders.
  Assert on the values produced, not merely that each interaction succeeded (lesson 8).
- [x] 8.2 Wire the new spec into CI's e2e glob and confirm it is actually collected (HEL-951 wired six
  previously-orphaned specs; confirm this one is picked up rather than assuming the glob covers it).

## 9. Gates

- [x] 9.1 `npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check` all green from
  `frontend/`. Record the actual commands and their output in `files-modified.md`.
- [x] 9.1a RUN `e2e/hel908-trunk-reorder-drag.spec.ts` and OBSERVE it green after the
  `TailChain` -> `LaneColumn` retirement; record the exact command and its output in `files-modified.md`.
  Asserting the class was preserved is not the same as observing the spec pass (lesson 8). Playwright
  oddness is contention with the concurrent runs until proven otherwise.
- [x] 9.2 Confirm the diff touches `frontend/**` plus the repo-root `e2e/` Playwright suite (where
  `playwright.config.ts` and the `hel908-*.spec.ts` files live) and NOTHING else. The forbidden set is
  `schemas/`, `backend/`, `helio-mcp/`, and the proposal/patch-set paths — HEL-914 is delivering
  concurrently and owns those. A file in the forbidden set is a STOP-and-escalate, not an edit.
- [x] 9.3 A Flyway validation failure is a STOP-and-report (quote Applied/Resolved values); never fall back
  to a scratch database. Playwright oddness is contention with the concurrent run until proven otherwise.
