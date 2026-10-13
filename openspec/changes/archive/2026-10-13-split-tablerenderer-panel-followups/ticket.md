# HEL-1449: After HEL-1399: mock getFilterCapabilities in chartTypeDefault test; stale comment/spec path pointers; TableRenderer.tsx 885 lines; Controls section off-screen in output-panel edit mode

## Description

Origin: HEL-1399 (matto00/helio#894, fd99c3dd), lane-reported.

1. `PanelDetailModal.chartTypeDefault.test.tsx`: mock `getFilterCapabilities` (`OutputControlsEditor.tsx:56`) to clear the last 2 AggregateErrors.
2. Stale comment pointers: `PanelCard.filterEmptyState.test.tsx:5`, `TableRenderer.test.tsx:1028`, `PanelContent.test.tsx:323`, `renderers/ChartRenderer.tsx:14`, `PanelContent.css:213`; and `openspec/specs/write-path-audit/spec.md:191` cites the non-existent `frontend/src/components/PanelDetailModal.tsx`. Finish with a zero-hit grep.
3. `TableRenderer.tsx` is ~885 lines. Split it behaviour-preserving (the HEL-1365/1399 precedent).
4. In output-panel edit mode, the Controls section sits below the visible area with no scroll hint (pre-existing). Verify in the running app, both themes; a product/UX call if non-obvious.
5. Dev-DB residue: 5 throwaway user rows remain (0c74c6f7-5cbf-48ae-8063-f9d9c20625b7, 06b2aa18-a744-4460-93fe-b9917636671b, 0127ac9e-1d76-4b98-8346-3a51581b106e, 768dd6b0-55ce-4def-90d1-047915cd9806, and the skeptic's user in `.concertino/runs/HEL-1399/evidence/skeptic-final-1-dev-db-ids.txt`). The `pipeline_run_rate_window` FK blocks a plain user delete (see HEL-1440 item 3, HEL-1301).

## Acceptance Criteria (derived from the items above; premise-validated 2026-10-13)

- AC1: `PanelDetailModal.chartTypeDefault.test.tsx` mocks `getFilterCapabilities`; the suite's AggregateError console-error count is 0 (recorded before/after); the suite still bites (mutation red-then-revert).
- AC2: every stale path/line pointer named in item 2 is fixed (re-derived: lines have moved since filing), plus every other missing path in the same `write-path-audit/spec.md` file-map table (7 rows, not 1). A final zero-hit grep is recorded.
- AC3: `TableRenderer.tsx` (903 lines at f63ab8365) is split behaviour-preserving; every touched/new source file < 400 lines; moved code byte-identical modulo whitespace and permitted `export` prefixes; hook order unchanged; existing tests change only in import paths.
- AC4: owner ruling `scroll-hint` (2026-10-13): `useScrollEdges` gains a vertical axis; the panel edit form shows top/bottom scroll-fades; `elevationTokenGuard.css.test.ts` pins the new declarations. Verified in the running app, light and dark, with before/after screenshots.
- AC5: the 5 dev-DB throwaway users are deleted by exact (id, email) via `e2e/support/userCleanupCore.cjs` `buildUserDeleteSql` (or recorded as already absent); dev DB only.
