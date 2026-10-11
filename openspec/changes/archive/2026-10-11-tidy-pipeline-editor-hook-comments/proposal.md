## Why

The HEL-1478/HEL-1481 hook splits moved code byte for byte, so comments describing the pre-split layout came along
unchanged: wrong handler counts, references to a removed `anchorHasTail` guard, a "defined below" pointer into another
file, and over-long rewritten lines. The split also left duplicate `EMPTY_OUTPUTS` sentinels and a 1205-line
characterization test whose data tables dominate the file. One open question (a duplicate convertformat PATCH after a
forced fillnull 422) was observed on base and never investigated.

## What Changes

- Correct the stale comments in `useStepCardState.ts`, `useStepCardPersist.ts`, `useStepCardState.test.ts`,
  `usePipelineShapeInstantiation.ts`, `usePipelineDetailPage.ts`, and re-wrap over-long comment lines in the split hooks.
- Replace the duplicated module-level `EMPTY_OUTPUTS` in `ui/LaneColumn.tsx` and `ui/PipelineRiverView.tsx` with one
  shared exported constant; fix the `usePipelineOutputSheets.ts` pointer; add an identity test.
- Move the characterization test's data tables into `useStepCardState.characterization.fixtures.ts`.
- Reproduce item 7; fix it only if trivial and behaviour-preserving (with a red-first test), otherwise file it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None (pure tidy-up; `skip_specs: true`).

## Non-goals

- HEL-1501's work: splitting `usePipelineDetailPage`/`pipelinesSlice`, deduping the settled-render test helper.
- Any behaviour change other than item 7, if fixed.
- Rewording comments beyond correcting what is stale.

## Impact

Frontend only, `frontend/src/features/pipelines/{hooks,ui,state}`. No API, schema, or migration changes.
