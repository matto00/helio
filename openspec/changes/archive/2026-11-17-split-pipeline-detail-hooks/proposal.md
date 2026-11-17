## Why

Two pipeline-detail hooks have grown well past the CONTRIBUTING soft size budget (~250 lines): `usePipelineDetailPage.ts` is
562 lines and `usePipelineDraftSave.ts` is 433 (both re-measured on main a6499da12, after HEL-1684). HEL-1733 (Outputs in a
draft) and HEL-1734 (roots in a draft) are queued to extend exactly this code, so it should be split along the seams they
will need first. Separately, HEL-1685's final skeptic found that on short narrow-desktop windows the step preview clips
its own title when the Output section is open.

## What Changes

- Split `usePipelineDetailPage.ts` into page wiring plus focused hooks, with draft-op routing (how a structure/config
  action becomes a draft op vs. an immediate write) in its own module. Behaviour-preserving; return shape unchanged.
- Split `usePipelineDraftSave.ts` into the save/cascade/reload orchestration hook, an undo hook, and pure helpers (save
  request building incl. base check and replay, notice messages). Behaviour-preserving; return shape and exported types
  unchanged.
- Give `.step-preview` a min-height that keeps its header (title) visible in the narrow-desktop disclosure layout,
  letting the step editor scroll inside itself instead; add an e2e layout guard at 900x600 / 900x700.
- Correct the stale comment at `PipelineSpineLayout.css:64`.

## Non-goals

- Fixing any bug found during the split (each becomes a filed follow-up).
- Changing the Output section's `min(30vh, 200px)` cap or the three-column layout.
- Implementing Outputs or roots inside a draft (HEL-1733, HEL-1734).
- Touching files owned by active lanes (HEL-1675: `PipelineSpineHeader.css`, `useNow`, `useTopModalDialog`).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-detail-spine-layout`: adds a requirement that the step preview's title stays visible on short narrow-desktop
  windows with the Output section open.

## Impact

Frontend only: `frontend/src/features/pipelines/hooks/` (two hooks split into new sibling modules),
`frontend/src/features/pipelines/ui/spine/StepPreviewTable.css` and `PipelineSpineLayout.css`, one new e2e spec. No API,
schema or backend change.
