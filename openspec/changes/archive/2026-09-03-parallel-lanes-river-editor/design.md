## Context

The editor's structural model is `frontend/src/features/pipelines/state/stepTree.ts`. `buildStepTree` walks
parent edges from the root and returns `{ trunk: Step[], tailsByStepId: Record<string, Step[]> }` — a shape
that can represent at most one branch per node. Its own doc comment states the invariant it enforces
("a node can have at most a trunk child and at most ONE tail root, never two-plus tails"), and
`PipelineRiverView.tsx:412` gates the "Branch" button on `!stepTree.tailsByStepId[step.id]`. Its only
producer is `usePipelineDetailPage.ts:245` (`useMemo`); its only consumers are `PipelineRiverView` and
`StepCard`'s `hasTail` prop.

The wire already carries everything lanes need. `Step` (`types/step.ts`) carries `parentStepId` and
`position`. `PipelineStep` carries `secondaryInput: {kind:"source",dataSourceId} | {kind:"lane",stepId}`
after V97's hard cutover. The narrowing layer is the explicit seam: `stepNarrowing.ts:502` and `:522` read
only the `source` arm and *"degrades to `""` rather than throwing when the config is lane-kind"*, and
`useStepCardState.ts:367-381` writes `{kind:"source"}` unconditionally — both commented
*"a lane-kind secondaryInput is authored by the editor lanes work, P2.2/HEL-912"*. This ticket is the
deferred half of a seam HEL-911 deliberately left open.

The P2.1 Engine contract (`openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md`) is
binding ground truth, not something to re-derive. Items that constrain this design directly: item 2
("trunk" is a UI notion owned by *this* ticket; the engine gives `position = 0` no structural meaning),
item 6 (a lane ref may name **any** non-self, non-ancestor node — not terminal-only, not single-consumer),
item 6b (forward references are an inherited *request-body* convention, **not** an engine limit; the
incremental `addStep`/`updateStep` path the editor uses has **no** ordering constraint), and item 11 (the
lane path format is pinned as root-to-step ids joined `" > "`, with display-name substitution explicitly
permitted at render time).

## Goals / Non-Goals

**Goals:**

- Generalize the grouping from trunk/at-most-one-tail to n lanes, with tails rendering byte-identically.
- A deterministic, unit-testable `(lane, row)` column-grid assignment extracted as its own file.
- Author a `{kind:"lane"}` secondary input from the editor, with ineligibility greyed *and reasoned*.
- Per-lane analyze, previews, Outputs rails, row counts, and mobile stacking. (The failing-lane-path
  highlight is explicitly NOT a goal — see Decision 5 and Non-Goals.)

**Non-Goals:**

- The failing-node lane-path highlight (Decision 5) — deferred on a verified gap in HEL-911, not trimmed.
- Multi-root roots (P2.3); MCP/proposal lane authoring (P2.4/HEL-914, concurrent); moving a step between
  lanes; fixing HEL-966; giving `join` a config editor it has never had.

## Decisions

**1. Replace `StepTree`, do not add a parallel model.** `buildStepTree` becomes `buildLaneGraph`, returning
`{ lanes: Lane[], laneOfStepId, primaryLaneId }` where a `Lane` is `{ id, parentStepId, steps: Step[],
depth }`. **The position-0 chain from the root is the PRIMARY lane, rendered at the top level; lanes are a
node's position >= 1 children.** A lane continues through single-child edges.

An earlier draft of this decision read "every child of a node roots a lane", which de-privileged the
position-0 continuation and is WRONG — it contradicted this change's own `pipeline-tails-ui` delta (a tail
renders "beneath the parent trunk step", presupposing a trunk that continues at top level; and "a pipeline
whose only branching is a single tail ... renders unchanged from pre-lanes"), and it contradicted the
`primaryLaneId` this same sentence returns, which is load-bearing at 7 non-test sites. Engine contract item
2 SANCTIONS this choice rather than forbidding it: *"'Trunk' is not an engine concept. It is a UI notion
owned by P2.2. The engine must contain no branch that treats a `position = 0` child as structurally special
beyond its role as the ordering tiebreak."* The engine disclaims the concept and hands the choice to this
ticket. Privileging position-0 in the UI is therefore the contract working as designed. This is a WORDING
fix, not a special case bolted onto a correct rule — a special case would leave the muddle in place for the
next reader. Two models over
one graph would drift, and the existing model's *only* two consumers are already being rewritten. The
`hasTail`/`tailsByStepId` API is deleted rather than kept as a shim — a shim would preserve exactly the
single-branch assumption this ticket exists to remove. `reorderTrunk` becomes `reorderLane(graph, laneId,
from, to)`, keeping its existing `parentStepId` relinking behaviour (the client-side mirror of
`reorderTrunkInternal`) scoped to one lane.

**2. `LaneLayout` is a separate pure module (`state/laneLayout.ts`), not a hook.** It takes the lane graph
and returns `{ slotOfStepId: Record<string, {lane:number,row:number}>, laneCount, rejoinEdges }`. Pure and
synchronous so the "deterministic column assignment" AC is a plain Jest assertion on a function, not a
render-order observation — lesson 8: assert what it *produced*. Column order is ascending sibling
`position`, array order as tiebreak (mirroring the engine's own tiebreak, contract item 4). A rejoin is
placed at `max(row of every input) + 1`, in the lane of its *parent* edge, and `rejoinEdges` names each
consumed node so the river can draw the spanning connector.

**3. The rejoin picker's eligibility rule is exactly the engine's, stated as a property.** Offered:
every node in the pipeline except the configuring step itself. Disabled-with-reason: the step's own
ancestors ("selecting this would create a cycle"). Nothing else is disabled. Explicitly **not** implemented:
any terminal-only filter, any single-consumer filter, any left-of/above-of ordering filter. Contract items
6 and 6b say the engine permits all three shapes; a UI restriction here would be a fabricated constraint,
and item 6b calls out that exact mistake by name. Ancestry is computed from the lane graph's parent edges
*plus* existing lane edges, since a lane edge is a real DAG edge (item 2) and a cycle can close through one.

**4. Narrowing gains a lane arm rather than a second config path.** `UnionConfigValue` /
`LookupConfigValue` change from `{ otherDataSourceId: string }` to a discriminated
`{ secondary: {kind:"source",dataSourceId} | {kind:"lane",stepId} }`, so `unionConfigOf`'s current
"degrade lane-kind to empty string" branch — which silently *loses* a stored lane reference on any
subsequent edit — disappears rather than being worked around. `useStepCardState.onUnionChange` /
`onLookupChange` widen the arm through unchanged. This is the seam HEL-911 named; touching it anywhere else
would leave the data-loss branch live.

**5. No failing-node lane-path highlight — deferred, on a verified gap, not a scope choice.** Contract item
11 pins the format, and `openspec/specs/pipeline-run-execution/spec.md:9` asserts it as a SHALL, but
HEL-911 shipped no such field: `grep -rn "lanePath\|lane path" backend/src/main/scala` returns nothing, and
`StepExecutionException` (`domain/engine/InProcessPipelineEngine.scala:25`) carries a structured `stepId`
that is flattened to free-text `runError` (`pipelinesSlice.ts:82`) before it reaches the client. Raised as a
contradiction escalation; answered `defer-to-followup`. Client-side derivation from `stepRowCounts` was
considered and rejected on the merits: a disabled node also reports no count (contract item 9), so the
derivation would silently mis-highlight, and a wrong highlight is trusted more than an absent one. String
-parsing `runError` was never on the table. The field and its format go to HEL-913, which owns backend/
engine and must anyway resolve item 11's ambiguity under multi-root. Per-lane row counts are unaffected —
`stepRowCounts` is already keyed by step id. The Outputs subtitle path (`off filter > lane 2 > aggregate`)
is unrelated and still ships, built from the lane graph.

**6. `join` is out of scope, stated rather than silently skipped.** `join` is absent from `OP_TYPES`
(`stepNarrowing.ts:116-117` lists `union` and `lookup` only; `JOIN_OP_TYPE` at `:124` exists solely so a
backend-loaded `join` step narrows without crashing) and has no `stepConfigs/JoinConfig.tsx`. It cannot be
created or configured in the editor today. Giving it one is a real feature, not a lane concern, and would
be scope beyond the ticket.

**7. Mobile stacking is a CSS-only breakpoint on the lane container.** Lanes are a flex row that becomes a
column below the existing phone breakpoint, with the lane header (hidden at desktop widths where lane
position carries the same information) revealed. No JS viewport branch — the existing `tap-expand-44`
utility already carries the 44px floor and is reused rather than re-implemented.

## Risks / Trade-offs

- **`PipelineRiverView` is already 516 lines** and lanes add rendering. The per-lane mini-river moves into
  a `LaneColumn.tsx` (generalizing `TailChain`), keeping both under the ~400-line guidance; `TailChain`'s
  compact one-step rendering survives as a branch of `LaneColumn`. There are NO frontend Jest snapshots, so
  "tails render identically" is not verifiable against snapshots (AC2's literal wording is unsatisfiable —
  see task 3.3). What IS machine-checkable is the `.pipeline-detail-page__tail-chain-item` DOM contract, guarded by
  exactly ONE running spec — `e2e/hel908-trunk-reorder-drag.spec.ts` (five locators). `hel908-tail-attach.
  spec.ts` looks like blast radius but is quarantined (`playwright.config.ts:47`, HEL-962) and collected by
  nothing, so it guards nothing. `LaneColumn`'s compact branch must preserve the class and its nesting; the
  requirement is correct, it just gets its force from one spec, not twenty.
- **`buildStepTree`'s position-based tail disambiguation (evaluation-1 cycle-2 CR1) must not regress.** The
  disambiguation is RETAINED in generalized form, not removed: the position-0 child is the primary lane's
  continuation and every position >= 1 child roots its own lane (Decision 1, as ruled mid-run). An earlier
  draft of this bullet said "every child roots a lane" and is repudiated — see Decision 1.
  The existing `stepTree.test.ts` cases are rewritten to pin the *lane* property, and each must be verified
  to fail against the un-generalized grouping (lesson
  8: a test that only asserts the call succeeded is not coverage).
- **Optimistic-state ordering.** `usePipelineDetailPage`'s add/insert/reorder handlers currently reason in
  trunk-relative indices. Each becomes lane-relative. `handleInstantiateShape`'s `trunkLastHasTail` guard
  (`PipelineRiverView.tsx:309-311`) exists only to prevent a second tail — an invariant being deleted — so it
  is removed, not adapted.
- **Playwright contention.** HEL-914 runs concurrently against the same browser session and dev Postgres.
  A flaky lane e2e is contention until proven otherwise; `hel908-full-flow` is already quarantined (HEL-964).

## Planner Notes

Self-approved: the `StepTree` → lane-graph replacement (internal, no wire or backend change); deleting the
`hasTail` API; deleting the second-branch refusal (a spec REMOVED with a stated migration); scoping the
picker to `union`/`lookup` per Decision 6.

**Found, not fixed — reported rather than absorbed.** `openspec/specs/pipeline-step-tree/spec.md` still
carries "Requirement: At most one trunk child per node" (line 70), which directly contradicts "Requirement:
Position orders siblings, not the whole pipeline" (line 20) added by HEL-911 in the same file. That is
residual drift from P2.1's own spec sync, describing *backend* enforcement this ticket does not own. No
backend code is touched — but the stale SPEC TEXT is removed here via a `REMOVED` block in this change's
`pipeline-step-tree` delta (an openspec edit, inside the boundary), rather than left flagged with no task.
A note without a task is how a stale requirement survives.
