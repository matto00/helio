# Files Modified — HEL-635

Pure structural move of 116 files across three `frontend/src/features/*/ui/` directories, plus the
relative-import updates that move requires. All 116 relocations are recorded by git as renames
(`R100` at move time, `R<50%` after the specifier fix, well below git's 50% rename threshold —
design.md's "13.9% worst case" risk note). No file was split, no prop changed, no CSS rewritten, no
file renamed or deleted.

## Renamed (116) — `git mv`, content otherwise unchanged except relative-import specifiers

**`frontend/src/features/pipelines/ui/` (64 moved)**

- `stepConfigs/` (42) — all 21 `{Op}Config.tsx`/`.test.tsx` pairs (Aggregate, Assert, CastFields,
  ChunkByTokenCount, ComputeField, DateBucket, Dedupe, ExtractHeadings, FillNull, Filter, Limit,
  Lookup, Pivot, RenameFields, SelectFields, Sort, SplitText, StringOps, Union, Unpivot, Window) —
  grouped per design.md D1; `StepCard` deliberately excluded, stays at the `ui/` root.
- `computedFields/` (5) — `ComputedFieldForm.{tsx,css}`, `ComputedFieldsEditor.{tsx,css,test.tsx}`.
- `schedule/` (5) — `PipelineScheduleDialog.{tsx,css,test.tsx}`, `schedulePreview.{ts,test.ts}`.
- `shapes/` (6) — `ShapeParamsFields.{tsx,css,test.tsx}`, `ShapePickerModal.{tsx,css,test.tsx}`.
- `proposalReview/` (6) — `PipelineProposalReview.{tsx,css,test.tsx}`,
  `PipelineProposalReviewPage.{tsx,test.tsx}`, `PipelineProposalSummary.tsx` — new group per D2
  (self-approved during design; six files postdate the ticket).

**`frontend/src/features/panels/ui/` (39 moved)**

- `detailModal/` (20) — every `PanelDetailModal.*` (component, 5 CSS, 2 `.css.test.ts`, 12 further
  `.test.tsx`).
- `grid/` (19) — `PanelGrid.*`, `PanelGridSkeleton.*`, `panelGridConfig.ts`,
  `panelGridSkeletonStubs.*`, `DesktopPanelGrid.tsx`, `DesktopPanelGridSkeleton.*`,
  `MobilePanelStack.*`, `MobilePanelStackSkeleton.*`, `mobilePanelHeights.*`.

**`frontend/src/features/sources/ui/` (13 moved)**

- `forms/` (13) — `CsvForm.tsx`, `RestApiForm.tsx`, `SqlTab.*`, `StaticSourceForm.*`,
  `TextSourceForm.*`, `PdfSourceForm.*`, `ImageSourceForm.*`.

## Modified in place (16) — relative-import re-pointing only, no other content change

- `frontend/src/features/pipelines/ui/StepCard.tsx` — 21 lines; imports 17 `../{Op}Config` types,
  now `../stepConfigs/{Op}Config`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — 17 lines, same 17 `{Op}Config`
  imports.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — 17 lines, same 17 `{Op}Config` imports.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — 7 lines, imports 7 per-source-type forms
  now under `forms/`.
- `frontend/src/features/panels/ui/PanelList.tsx` — 3 lines (grid/detailModal re-point).
- `frontend/src/features/panels/ui/PanelList.{test,onboarding.test,gridWidthSharing.test}.tsx` — 2
  lines each.
- `frontend/src/app/AppRoutes.tsx`, `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx`,
  `frontend/src/features/proposals/ui/CombinedProposalReview.tsx`,
  `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.tsx`,
  `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx`,
  `frontend/src/features/pipelines/ui/{PipelineDetailPage,PipelineRiverView}.tsx` — 1 line each.

78 changed lines total across these 15 files — matches design.md D5's measured figure exactly.

- `docs/compute-expression-grammar.md` — 1 line: updates the `ComputeFieldConfig.tsx` path citation
  to `pipelines/ui/stepConfigs/ComputeFieldConfig.tsx` (task 5.3). `docs/uploads.md` and
  `notes/mobile-pwa-handoff.md` cite paths that did **not** move (`markdownUrls.ts` stayed at the
  `panels/ui/` root; `renderers/` is an untouched pre-existing subdirectory) — left alone
  deliberately, verified not stale.

## New file

- `scripts/check-move-integrity.mjs` — the move-integrity gate (design.md D4/D6). Re-derives
  `BASE = git merge-base origin/main HEAD` every run; asserts non-vacuity (>=116 renames),
  whole-repo status (no D/T anywhere, A only under this change's `openspec/` dir or this script,
  the only non-`frontend/` M is the docs line above), a whole-tree tracked-path-set match against
  the baseline-plus-renames (closes the "file moved/dropped outside the three `ui/` dirs" hole),
  a normalize-and-compare content check (quoted relative literals replaced with a fixed-length
  placeholder, both sides run through prettier, byte-identity required — prettier erroring on
  either side is a failure, never a skip), a statement-level substitution-site check (every quoted
  relative literal must sit in an accepted import/export/require/jest.mock/jest.requireActual/
  dynamic-import form), and an extension-aware specifier-target check (resolves both sides against
  their own tree and the rename map; an unresolvable specifier is a failure, never a skip).
  Evaluator/skeptic re-run: `node scripts/check-move-integrity.mjs`.

## Known-stale, deliberately not touched (task 8.1)

- `frontend/src/features/pipelines/ui/PipelineDetailPage.css.test.ts:13` cites
  `../../panels/ui/PanelDetailModal.css.test.ts` inside a **backtick** code-span comment (not a
  quoted specifier, so the move-integrity content/site checks correctly leave it alone). That
  target moved to `detailModal/`; the comment is now stale. Left as-is per design.md — editing a
  comment would itself be flagged by the content check as "differs beyond import/path-specifier
  lines." Raised as a follow-up, not fixed inline.
