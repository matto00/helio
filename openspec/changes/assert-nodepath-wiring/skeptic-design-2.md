## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`, `skeptic-design-1.md`. Then
re-derived every grounding fact from the tree rather than from the plan's narrative.

- **Round 1's three CRs are genuinely addressed.** `design.md` D4 now names the `rootId` trap
  (`types/step.ts:49`, `nodePath.ts`'s `rootStepIds.has(currentId) && step.rootId` gate) and the `linkChain`
  trap; `tasks.md` 1.1 carries both as MUSTs; risk 2 carries the mutation-A discrimination check; risk 4 and
  task 3.3 require mutation B's red to be on a **new** assertion. Verified `linkChain`
  (`PipelineRiverView.test.tsx:35-41`) does auto-link `parentStepId === undefined` to the previous array
  element, and that `stepA`–`stepD` (lines 52-79) set no `rootId`. The revisions are accurate.
- **`nodePath.ts` read in full.** Fallback to bare `stepId` on `pathsByRootId.size === 0`; final line
  `[\`root:${bestRootId}\`, ...trail].join(" > ")`. Mutations A and B are well-targeted; D5's exact-string
  assertion is the right call.
- **Threading and title sites re-enumerated by grep, and this is where the plan is wrong.** `nodePathByStepId`
  is passed down at **four** places, not the two design.md's Context bullet names: `PipelineRiverView.tsx:461`
  (trunk step's child lanes → `LaneColumn`), `PipelineRiverView.tsx:539` (→ `RootColumn`), `RootColumn.tsx:114`
  (→ `LaneColumn`), `LaneColumn.tsx:146` (→ nested `LaneColumn`). Title sites: `PipelineRiverView.tsx:381`,
  `LaneColumn.tsx:171`, `LaneColumn.tsx:216`.
- **`LaneColumn`'s two title sites are mutually exclusive branches keyed on `isCompact`** (`LaneColumn.tsx:151`
  `if (isCompact)` → the `.tail-chain-step` site at 171; otherwise the `.step-section` site at 216).
  `RootColumn.tsx:112` passes **`isCompact={false}` unconditionally**. `PipelineRiverView.tsx:459` and
  `LaneColumn.tsx:144` pass `isCompact={childLane.steps.length === 1}`.
- **`extraRoots = roots.slice(1)`** (`PipelineRiverView.tsx:430`, rendered at 510-540) — root 0 renders inline,
  never as a `RootColumn`. The `.pipeline-detail-page__root-column` class is also carried by the
  `--add` pseudo-column (`PipelineRiverView.tsx:545`).
- **`baseProps` hardcodes `laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT)` and `roots: ONE_ROOT`**
  (`PipelineRiverView.test.tsx:88-90`), with `...overrides` spread last (line 117).
- `skip_specs: true` remains justified; ACs still trace to tasks (AC1→2.2/2.3, AC2→2.4, AC3→3.1, AC4→3.3,
  AC5→3.2/3.4/4.x, AC6→D6/4.1) — but AC2's coverage claim does not hold, per CR1/CR2 below.

### Verdict: REFUTE

The plan's mutation discipline and fixture-trap handling are now sound. It fails on a factual error about the
render topology that makes AC2 unsatisfiable as planned, plus two probe/fixture hazards that would let the
guard be built against a shape that does not exist.

### Change Requests

1. **`design.md` Context bullet 2 + D4 + `tasks.md` 2.4 — `LaneColumn.tsx:171` is NOT reachable through
   `RootColumn`.** design.md states root 2's lane makes "both `LaneColumn` title sites reachable". It cannot:
   `RootColumn.tsx:112` hardcodes `isCompact={false}`, and `LaneColumn.tsx:151`'s `if (isCompact)` early-return
   is the only path to the `.tail-chain-step` title at line 171. Every step rendered under a `RootColumn` takes
   the line-216 branch. Correct the design fact, and require the fixture to also contain a **single-step child
   lane** (`childLane.steps.length === 1`, so `isCompact` is true) hanging off a trunk step, which is the only
   way line 171 renders. Add a task asserting that step's exact `root:`-headed title.

2. **`design.md` Context + `tasks.md` 2.4 — `PipelineRiverView.tsx:461` is a fourth threading edge and is
   uncovered.** A trunk step's child lanes get `nodePathByStepId` directly from `PipelineRiverView:461`, not via
   `RootColumn`. The planned fixture (root 1 = trunk only, root 2 = lane via `RootColumn`) exercises `:381` and
   `:539→RootColumn:114` only. Dropping the prop at `:461` — or at `LaneColumn.tsx:146` for a nested lane —
   would render `title=undefined` with every gate green, i.e. exactly HEL-968's defect on a different edge.
   Enumerate all four threading edges in design.md and require the fixture to cover `:461`. (CR1's compact
   child lane covers `:461`+`:171` together; a ≥2-step child lane on a trunk step covers `:461`+`:216`.)

3. **`tasks.md` 1.2 — the "two root columns render" probe is wrong as written.** Root 1 never renders as a root
   column (`extraRoots = roots.slice(1)`), and the `--add` pseudo-column
   (`PipelineRiverView.tsx:545`) carries the same `pipeline-detail-page__root-column` class — so a correct
   two-root fixture yields one real column plus the add column, and a collapsed single-root fixture yields the
   add column alone. A count-of-two check would pass or fail for the wrong reason. Specify the probe as
   `screen.getByLabelText("Root: <root-2 dataSourceName>")` (`RootColumn.tsx:78`) plus the presence of root 1's
   trunk steps outside it. Relatedly, `design.md` risk 1's suggested `aria-label="Lane"` probe does not hold for
   a compact lane, which renders `aria-label="Tail steps"` (`LaneColumn.tsx:165`) — state which label belongs to
   which branch.

4. **`tasks.md` 1.1 — the new fixture must override `laneGraph` as well as `roots`.** `baseProps`
   (`PipelineRiverView.test.tsx:88-90`) hardcodes `laneGraph: buildLaneGraph(resolvedSteps, ONE_ROOT)` and
   `roots: ONE_ROOT`; only `steps` is derived from overrides. Passing `roots: TWO_ROOTS` alone leaves the graph
   seeded from one root, so root 2 gets no lane and `RootColumn` renders its "No steps yet" branch
   (`RootColumn.tsx:117-121`) — a silently wrong shape. Require passing `roots` **and**
   `laneGraph: buildLaneGraph(twoRootSteps, TWO_ROOTS)` together (and note `nodePath`'s tiebreak reads root
   order from the same `roots` array).

### Non-blocking notes

- The existing `sectionFor()` helper (`PipelineRiverView.test.tsx:121-127`) queries
  `.closest(".pipeline-detail-page__step-section")`, which will not find the compact tail-chain title site
  (`.pipeline-detail-page__tail-chain-step`). D3's `closest("[title]")` is the right query and should be used
  directly rather than by reaching for the existing helper.
- Round 1's non-blocking note about AC4's letter-vs-spirit is now carried in design.md risk 4 and task 3.3.
  Good.
- D6's zero-non-test-edit reading of AC6 still holds after the above: none of CR1–CR4 requires a product edit.
