## Why

HEL-1483 left five follow-ups on the pipeline editor (HEL-1501). The one user-visible gap: when this mount's steps
fetch fails, the Steps tab silently shows the empty editor, which reads as "this pipeline has no steps" and offers
live Add buttons on a pipeline whose steps are unknown. DESIGN.md §7 forbids swallowing a failed fetch. The rest is
maintenance: a duplicated skeleton, three copies of a test helper, two files over the ~400-line guideline, and
switch tests whose names and assertions no longer match the code.

## What Changes

- Steps tab: a failed steps fetch renders a section-sized `PageStatus` error with Retry instead of the empty editor;
  Retry re-fetches the steps (skeleton while in flight; analyze too if it had failed). Footer step count reads as
  unknown while failed.
- New shared `PipelineRiverSkeleton` used by `PipelineDetailSkeleton` and the steps-loading branch.
- One shared settled-render test helper for the three pipeline-detail test files.
- Behaviour-preserving splits of `usePipelineDetailPage.ts` (592 lines) and `pipelinesSlice.ts` (707 lines), with
  `pipelinesSlice.ts` re-exporting every name it exports today.
- Switch tests: two renames, one added assertion, `act(...)` warnings cleared.
- Item 6 (disable Run/Dry run while the skeleton shows): assumed product call, keep them enabled (no change).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-editor-page`: adds the requirement that a failed steps fetch shows an error with Retry, not the empty
  editor.

## Impact

Frontend only: `frontend/src/features/pipelines/{hooks,state,ui}` and their tests. No backend, schema, API or
migration change.

## Non-goals

- No change to Run/Dry run enablement (assumed call A2).
- No change to the page-level pipeline load error.
- Files in parked PRs #998/#994 (laneLayout.ts, SecondaryInputPicker.tsx, patchSets/*, assistant/*) are untouched.
- HEL-1484 is Done; its items are not redone.
