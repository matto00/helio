# HEL-1430: After HEL-1389: split OutputEditorSheet.tsx (~729 lines) seeding from configPatch openingParams; fix wrong pre-fix comment in configPatch test; key the sheet in PipelineDetailPage

## Description

Origin: HEL-1389 (matto00/helio#876, 6f2351e8), lane-reported. Priority Low, label Follow-up.

1. `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` is ~729 lines, against CONTRIBUTING's ~400.
   Proposed split (from the PR body): seed the sheet state from `configPatch.ts`'s `openingParams`, which removes the
   duplicated seeding, and move the per-kind state into one hook. Behaviour-preserving; the 22 tests in
   `OutputEditorSheet.configPatch.test.tsx` must stay green.
2. `OutputEditorSheet.configPatch.test.tsx:246-247`: the comment says the metric-pairing guard passes on pre-fix code.
   It actually fails there. One-line fix.
3. `PipelineDetailPage.tsx:333`: the sheet is mounted without a `key` (this predates HEL-1389). Key it by Output id so
   opening another Output while it is mounted reseeds the state. Add a test if reachable.

## Acceptance Criteria

- AC1: `OutputEditorSheet.tsx` is split to ~400 lines or under; per-kind editor state lives in one hook seeded from
  `configPatch.ts`'s `openingParams` (no second, independent copy of the per-kind seeding logic). Behaviour-preserving.
- AC2: The 22 tests in `OutputEditorSheet.configPatch.test.tsx` and HEL-1388's `OutputEditorSheet.kindLock.test.tsx`
  (and every other existing outputEditor/PipelineDetailPage test) stay green with at most import-only edits.
- AC3: Every Output kind's opening state (create and edit mode) is identical before/after, proven by a characterization
  test committed and green on the unmodified base first, and by the running editor in light and dark themes.
- AC4: The metric-pairing guard's comment (`OutputEditorSheet.configPatch.test.tsx`, ~line 242) states the verified
  truth about pre-fix behaviour.
- AC5: `PipelineDetailPage` mounts the sheet with a `key` derived from the Output id (create mode keyed distinctly), so
  opening a different Output while the sheet is mounted reseeds all its state; covered by a test that is red on the
  base (or, if unreachable, a guard labelled as such).

## Driver notes (claims, verified at premise validation)

- HEL-1388 (#878) since locked the Kind select in edit mode (aria-describedby hint, `OutputEditorSheet.kindLock.test.tsx`).
  File is now 739 lines on origin/main 0a528316.
- HEL-1432 (queued next) touches the same editor (Kind/Step label `htmlFor` → shared Select `id`; table options overflow
  at 375px). Out of scope here; not absorbed.
