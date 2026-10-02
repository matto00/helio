## Why

HEL-973 unfenced `PUT /api/pipelines/:id/steps/order` for multi-root pipelines, but the editor only wires
move up/down and drag-reorder for root 0's lane. Every other root's lane (rendered via `RootColumn` ->
`LaneColumn`) passes `NOOP_MOVE`, so its Move buttons render permanently disabled and its drag handle does
nothing, with no indication why. The backend capability is therefore partly unusable from the UI.

## What Changes

- Every root's **trunk lane** (root 0 and every `RootColumn` lane) gets working Move up / Move down and
  drag-reorder, scoped to that lane's own steps and root.
- `NOOP_MOVE` is removed. The only lanes left without reorder controls are **non-trunk (branch) lanes**,
  which the backend contract genuinely does not reorder (the reorder endpoint permutes trunk ids only; a tail
  travels with its trunk step). Those render no move/drag controls at all instead of permanently disabled ones.
- Move buttons gain accessible names that identify the lane/root, keep keyboard operability, and focus
  follows the moved step.
- The HEL-973 CR2 guard in `handleReorderSteps` gets honest coverage (or, if it proves unreachable through
  any live path, an evidenced escalation) and its "deliberately untested" note is removed/rewritten.
- A real-browser Playwright spec reorders root 1's lane, reloads, and asserts the order persisted.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-lane-editor-ui`: "Drag-reorder operates within a lane" is extended: every root's trunk lane is
  reorderable, controls are accessibly named per lane, focus follows the moved step, and non-trunk lanes
  expose no reorder controls.

## Impact

- Frontend only: `PipelineRiverView.tsx`, `LaneColumn.tsx`, `RootColumn.tsx`, `StepCard.tsx` (labels/focus),
  `usePipelineDetailPage.ts` (comment only, plus tests), new e2e spec.
- No backend, schema or API change (contract verified, not assumed - see design.md).
