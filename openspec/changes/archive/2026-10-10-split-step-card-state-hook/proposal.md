## Why

`hooks/useStepCardState.ts` (602 lines) and `hooks/usePipelineStepStructure.ts` (271 on main, ~274 after HEL-1478) are
over CONTRIBUTING's ~250-line soft budget. Both were deferred from HEL-1478 (items 4 and 5) to keep that PR reviewable.

## What Changes

- Split `useStepCardState` into focused modules called in place: the handler-surface type, the per-op editor state
  (with the save-error state pair and its during-render resync), the debounced persist path (debounce/token refs,
  unmount cleanup, `persist`, `emitOrPersist`), and the per-op change handlers. `useStepCardState` keeps its name, signature and
  return shape, so `StepCard`, `StepOpEditor` and every test keep importing it unchanged.
- Trim `usePipelineStepStructure` under ~250 by extracting `handleInstantiateShape` into its own sub-hook, called in
  place.
- Split `usePipelineStepCreation` (405, over the ~400 threshold) by extracting its trailing `handleAddLaneStep` and
  `createDraftIfComplete` callbacks into two consecutive sub-hooks called in place.
- A separate comment-only commit corrects the five cross-file comment pointers HEL-1478's review listed (and the
  same class of pointer made wrong by this PR's own moves).
- Behaviour-preserving only: byte-proven moves, unchanged hook primitive sequence, unchanged deps arrays (plus
  provably-stable additions only), test files import-only in split commits.

## Non-goals

- Any behaviour, DOM, wire-shape or copy change; fixing bugs found along the way (filed as follow-ups).
- Rewording stale comments inside moved code within the split commits (the separate comment-only commit handles
  cross-file pointers; other stale comments are follow-up candidates).
- HEL-1483 (separate bug on base).
- Further splitting of `usePipelineDetailPage.ts` or `StepCard.tsx`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — pure refactor; `.openspec.yaml` sets `skip_specs: true`)

## Impact

- Frontend only: `frontend/src/features/pipelines/hooks/useStepCardState.ts` (+ new sibling modules),
  `frontend/src/features/pipelines/hooks/usePipelineStepStructure.ts` (+ one new sibling sub-hook),
  `hooks/usePipelineStepCreation.ts` (+ two new sibling sub-hooks), comment-only edits to
  `hooks/usePipelineOutputSheets.ts`, `hooks/usePipelineDebouncedAnalyze.ts`, `hooks/usePipelineRunAndSaveActions.ts`, plus one new
  characterization test committed green on base first.
- No API, schema, migration or backend change.
