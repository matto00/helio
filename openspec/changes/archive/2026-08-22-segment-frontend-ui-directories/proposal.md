## Why

Three `frontend/src/features/*/ui/` directories have outgrown a flat listing: `pipelines/ui/` holds 101 files,
`panels/ui/` holds 76 at its root, `sources/ui/` holds 30. In `pipelines/ui/` alone, 42 step-op config files bury the
15 page-level components a reader is usually looking for. Grouping them restores scannability. Doing it now, as part of
HEL-632, keeps the churn in one reviewable change instead of colliding with future feature work in these directories.

## What Changes

- `features/pipelines/ui/` gains `stepConfigs/` (42), `computedFields/` (5), `schedule/` (5), `shapes/` (6) and
  `proposalReview/` (6); 37 page-level files stay at the root. `StepCard` stays at the root, where the pipeline-op
  wiring checklist expects it.
- `features/panels/ui/` gains `detailModal/` (20) and `grid/` (19); 37 files stay at the root. The existing
  `creationSteps/`, `creators/`, `editors/`, `renderers/` subdirectories are untouched.
- `features/sources/ui/` gains `forms/` (13); 17 pages and shared affordances stay at the root.
- Relative import specifiers are re-pointed across the frontend. There are no `tsconfig`/`vite` path aliases, so every
  affected reference is a relative specifier.
- Two live docs that cite a moved path are updated. Archived `openspec/changes/**` documents are left alone as
  historical records.

## Capabilities

### New Capabilities

- `frontend-ui-directory-structure`: records the segmentation convention this change establishes — which role-named
  subdirectory a new file belongs in, that co-located stylesheets and tests move with their component, that
  disk-reading tests resolve paths relative to their own directory, and that a segmentation change must be a pure
  rename. Without it the convention lives only in this change's prose and future files drift back to the flat root.

### Modified Capabilities

None. No existing requirement changes. The two canonical specs that cite these paths
(`chart-type-config-editor`, `panel-config-field-or-literal-pattern`) both reference `panels/ui/editors/`, an existing
subdirectory this change does not touch. `panel-detail-modal-css-structure` references `PanelDetailModal*` by filename
only, and filenames are unchanged.

## Non-goals

- No component splits, prop changes, CSS rewrites, renames, or deletions.
- No rename of `PanelDetailModal.css.test.ts`, whose name is stale (it reads `PanelDetailModal.mobile.css` by design,
  guarding the HEL-245 mobile tap-targets). Preserved verbatim; raised separately as a follow-up.
- No changes outside `frontend/`, and no changes to other worktrees or branches.

## Impact

`frontend/src/features/{pipelines,panels,sources}/ui/**` (116 files relocated) plus the **measured** set of 15 files
carrying 78 incoming specifier lines. The two largest are in the same feature's non-`ui/` directories —
`features/pipelines/hooks/useStepCardState.ts` and `features/pipelines/state/stepNarrowing.ts`, 17 `../ui/*Config`
imports each — and `features/pipelines/ui/StepCard.tsx` (21). `app/App.tsx` and `shared/ui/` need **no** change: they
import `CreatePipelineModal`, `PanelBodySkeleton` and `PanelCardSkeleton`, all of which stay at their roots. Full table
in design.md D5.

No API, schema, dependency, or backend impact. `jest.config.cjs` needs no change: its `testMatch` is a recursive glob
and its `moduleNameMapper` keys are module-name-based, not directory-based.
