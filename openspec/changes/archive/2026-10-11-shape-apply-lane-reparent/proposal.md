## Why

Applying a shape at the bottom of a pipeline whose primary-lane last step has a lane moves that lane under the shape's
last step on the server (a splice), but the editor ignores the create responses' `reparentedStepIds`, so it keeps drawing that lane
under the anchor instead of under the shape's last step until a reload (HEL-1506, found by HEL-1484's live probe). The owner chose
option (b): keep the server behavior and make the editor reflect it.

## What Changes

- The shape-instantiation handler applies each step create's `reparentedStepIds` to local editor state using the same
  delta application the ordinary step create already uses (`applyCreatedStep`), so the editor matches the server with
  no reload, including after a partial apply.
- The "KNOWN HAZARD" comments in the shape hook and `PipelineRiverView` are rewritten to describe the new behavior.
- The `pipeline-shape-instantiation-ui` spec's stale claim that a shape against a step with children is seeded as a
  new tail (tail-attach) is corrected: it is a splice, and lanes hanging off the anchor move below the shape.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-shape-instantiation-ui`: seeding a shape against an anchor with existing children is a splice that moves
  those children under the shape's last step, and the editor reflects every reported reparent without a reload.

## Impact

- Frontend only: `frontend/src/features/pipelines/hooks/usePipelineShapeInstantiation.ts` (and its wiring in
  `usePipelineStepStructure.ts` / `usePipelineStepCreation.ts` if the shared apply helper is threaded through),
  `PipelineRiverView.tsx` comment, tests.
- No backend, API, schema or migration change.

## Non-goals

- Options (a) attach-as-lane, (c) `rejectIfReparents`, (d) a new continuation-without-reparent create mode.
- Changing splice semantics for any other create path.
- The per-step "+ output" shape entry spec text beyond the reparent behavior.
