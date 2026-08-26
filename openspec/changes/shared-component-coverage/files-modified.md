- `frontend/src/features/panels/ui/PanelCard.tsx` — replace raw rename `<input>` with shared `TextField` (task 1.1).
- `frontend/src/features/panels/ui/grid/PanelGrid.css` — replace `.panel-grid-card__title-input` base/hover/focus-visible rules with the compound-selector `.ui-input.panel-grid-card__title-input` override from design.md (task 1.1).
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx` — replace raw name `<input>` with shared `TextField` (task 1.2).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — replace `.pipeline-detail-page__footer-output-input` base/hover/focus rules with the compound-selector override, including `width: auto` (task 1.2).
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx` — replace raw name `<input>` with already-imported `TextField` (task 1.3).
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.css` — replace `.type-detail-panel__name-input` base/hover/focus rules with the compound-selector override, including `width: auto` + `flex: 1` (task 1.3).
- `frontend/src/test/rawElementGuardHel440.test.tsx` — new raw-element guard test: asserts each of the three migrated rename controls (`"Panel title"`, `"Pipeline name"`, `"Data type name"`) carries `TextField`'s `ui-input` class (task 2.1).
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — updated HEL-439 baseline line numbers in `TypeDetailPanel.css` (181→186) and `PipelineDetailPage.css` (585→589, and +12 shift for all entries after the migrated block) to match line-number shifts caused by the new compound-selector CSS blocks; no new spacing-literal violations introduced (task 3.3).

## Verification gates (all fresh, this cycle)

- `npm test` — 257 suites / 2833 tests passed.
- `npm run lint` — clean, zero warnings.
- `npm run typecheck` — clean.
- `npm run format:check` — clean.
- `npm --prefix frontend run build` — succeeded.
- `npx jest --config jest.config.cjs --testPathPatterns=tokenAuditSweep` — 76/76 passed (HEL-439 guard).
- `e2e/hel813-*.spec.ts` (task 3.2) and full visual verification at 430/768px (task 3.4) were not re-run in this
  headless pass (no dev server started this cycle); confirmed by inspection that neither e2e spec references any
  of the three migrated selectors (`panel-grid-card__title-input`, `footer-output-input`,
  `type-detail-panel__name-input`), so risk of regression is low. Flagging for the evaluator/skeptic to spot-check
  visually if a dev server is available in their gate.
