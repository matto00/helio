## Why

P2.1 (HEL-911) removed every structural fence in the engine: any node may now have any number of step
children, and `join`/`union`/`lookup` accept a `{kind:"lane", stepId}` secondary input that makes a rejoin a
real DAG edge. The editor cannot express any of it. `buildStepTree` still collapses the graph into a single
trunk plus at-most-one tail per node, the river renders that shape only, and `useStepCardState` hard-codes
`{kind:"source"}` on every secondary-input write — HEL-911 explicitly deferred lane authoring here. So the
capability the user chose the river layout *for* ("two rows next to each other, divergent steps later
reconciled via joins") is shipped in the engine and unreachable in the product.

## What Changes

- **BREAKING (internal):** `buildStepTree`'s trunk/tail model is generalized into a lane graph. `StepTree`'s
  `tailsByStepId` single-tail invariant is deleted, not flagged. Tails become one-step lanes and keep their
  existing compact rendering.
- New `LaneLayout` unit: assigns every node a deterministic `(lane, row)` column-grid slot from the flat
  `Step[]`, so sibling lanes render side by side and a rejoin visually spans back to one column. Extracted as
  its own file so `PipelineRiverView` stays under the ~400-line guidance.
- **"+ lane"** affordance on any step (replacing the single-tail-gated "Branch" button, whose one-tail-per-node
  disable disappears with the invariant).
- **"Rejoin"** on a lane step opens the `join`/`union`/`lookup` config with an **other lane** selector listing
  visible lanes alongside today's data-source picker. The narrowed UI config gains a lane arm and
  `useStepCardState` widens it to `{kind:"lane", stepId}`. Self and ancestors are greyed with a stated reason.
- Lane-aware Outputs rail and Outputs tab subtitle (`off filter › lane 2 › aggregate`); per-node analyze
  schema and validation errors render on every lane; SSE row counts render per node across lanes.
- Mobile: lanes stack vertically under a lane header at phone widths; the ≥44px touch-target floor holds.

## Capabilities

### New Capabilities

- `pipeline-lane-layout`: deterministic column-grid assignment of a pipeline's DAG nodes to lanes and rows.
- `pipeline-lane-editor-ui`: "+ lane" authoring, per-lane mini-rivers, mobile lane stacking.
- `pipeline-lane-rejoin-picker`: "other lane" secondary-input selection, with ineligible lanes greyed and
  reasoned.
- `pipeline-lane-run-reporting`: per-node row counts across lanes.

### Modified Capabilities

- `pipeline-step-tree`: the single-trunk / at-most-one-tail-per-node grouping becomes an n-lane grouping.
- `pipeline-tails-ui`: a tail is redefined as a one-step lane; its rendering is unchanged.
- `pipeline-outputs-rail`: the "off `<step>`" subtitle gains a lane segment.

## Impact

`frontend/` plus the repo-root `e2e/` Playwright suite. Touched: `features/pipelines/state/stepTree.ts` (+ new `laneLayout.ts`),
`ui/PipelineRiverView.tsx`, `ui/TailChain.tsx`, `ui/StepCard.tsx`, `ui/OutputsRail.tsx`,
`ui/OutputsGalleryTab.tsx`, `ui/stepConfigs/{UnionConfig,LookupConfig}.tsx`,
`state/stepNarrowing.ts`, `hooks/useStepCardState.ts`, `hooks/usePipelineDetailPage.ts`, plus the pipeline
detail page CSS. No backend, `schemas/`, `helio-mcp/`, or proposal/patch-set change — the engine and wire
contract already exist and are consumed as-is.

## Non-goals

- Multi-root roots in the editor (P2.3).
- MCP and proposal authoring of lanes (P2.4 / HEL-914, in flight concurrently).
- Moving a step between lanes (out of scope unless trivial).
- The failing-node lane-path highlight. NOT a scope trim: the wire field the spec asserts was never shipped
  by HEL-911; escalated, answered `defer-to-followup`, routed to HEL-913. See design.md Decision 5.
- Fixing HEL-966 (deleting a branching node absorbs one lane and deletes every other lane's subtree) — a
  backend delete-semantics defect filed off P2.1.
