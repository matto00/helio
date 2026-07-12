## Files modified

- `frontend/src/shared/ui/DataGrid.tsx` — expanded the JSDoc on the `density` prop to document all
  three modes (with their padding/font-size token mapping), the variant-based defaults, and the
  guidance that consumers should rely on the default rather than pass an explicit override without
  a documented reason (task 1.2). No behavior change — the `density` prop, `DEFAULT_DENSITY` map,
  and class-name derivation were already correct (verified against `DESIGN.md`'s `--space-*`/
  `--text-*` tokens in `DataGrid.css`, task 1.1 — no fix needed).
- `frontend/src/shared/ui/DataGrid.test.tsx` — added three explicit-override test cases (condensed
  overriding full's normal default, normal overriding preview's condensed default, spacious applied
  to the full variant) to close the gap where only the preview→spacious override path was
  previously asserted (task 4.1).
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.test.tsx` — added a smoke test asserting the
  rendered preview `DataGrid` carries `ui-data-grid--condensed` (variant default), guarding against
  a future accidental explicit-density regression at this call site (task 4.2).
- `frontend/src/features/sources/ui/SourceDetailPanel.test.tsx` — added a smoke test asserting the
  rendered preview `DataGrid` (the CSV-preview section, triggered via the "Preview" button —
  distinct from the hand-rolled `<table>` used for the "Inferred schema" section, which is not a
  `DataGrid` instance) carries `ui-data-grid--condensed` (task 4.2). First attempt at this test
  incorrectly targeted the schema section before `handlePreview()` fires the DataGrid render;
  fixed by mocking `fetchCsvPreview` and clicking the "Preview" button first.
- `frontend/src/features/sources/ui/SqlTab.test.tsx` — extended the existing "shows inferred fields
  on successful test connection" test with a density-class assertion on the rendered `DataGrid`
  (task 4.2).
- `DESIGN.md` — added `DataGrid` to the section 6 "Shared components" primitive list (flagged as a
  minor gap by the skeptic during planning) and added a "DataGrid cell density" subsection
  documenting the three modes, their token mapping, and the variant defaults (task 3.1).
- `openspec/changes/cell-density-data-grid/tasks.md` — all 13 tasks marked complete.

## Verification (no fix needed)

- Confirmed all six current `DataGrid` consumers (`TypeDetailPanel`, `SourceDetailPanel`,
  `PipelinePreviewModal`, `StepCard`, `SqlTab`, `TableRenderer`) render `<DataGrid>` without an
  explicit `density` prop, correctly inheriting the variant default (tasks 2.1–2.7). No consumer
  diverged; no fix was required.
- Confirmed `DataGrid.css`'s per-density rules use `--space-*`/`--text-*` tokens exclusively, no
  hardcoded pixel values (task 1.1).

## Scope note

Per the ticket's descoped-to-primitive-hardening context (recorded in `design.md`'s Non-Goals), no
backend files were touched — `TablePanelConfig`, its codec/patch, and panel schema files are
untouched. The Table panel config dropdown for density is deferred to HEL-255.

## Environment note (unrelated to this change)

This worktree's `frontend/node_modules` did not exist (the `setup-worktree.sh` hooks only run
`npx husky install`, not an install step — a known gap). Since `frontend/package.json` and
`package-lock.json` are identical to the main checkout's, a symlink
(`frontend/node_modules -> <repo-root>/frontend/node_modules`) was created to unblock `npm test`
and the build gate. The symlink is gitignored and not part of this change's diff.
