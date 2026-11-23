## Standing Constraints

## 1. Red evidence

### Tests
- [x] 1.1 Add `FormPanel.css.test.ts` guard for the new `:empty` rule and `position: relative` field stack (red on current CSS)
- [x] 1.2 Add `FormPanelView.test.tsx` test (a): rejection, later no-response step, successful aggregate → not aria-invalid (red)
- [x] 1.3 Add the e2e multi-field gap check (hel1791 spec if HEL-1826 merged, else new `e2e/hel1819-form-live-region-gap.spec.ts`)
- [x] 1.4 Run the full jest files and the full e2e spec on unmodified source; save output; commit the red run

## 2. Implementation

### Frontend
- [x] 2.1 Grep the form subtree for absolute descendants affected by a positioned field stack; record findings
- [x] 2.2 `FormPanel.css`: `position: relative` on `.form-panel-view__fields` plus the `:empty` out-of-flow rule (D1); rewrite the now-misleading 'zero height already' comment
- [x] 2.3 `FormPanelView.tsx`: `onReconciled` on `reconciliationTail` and the per-burst rejection flag (D2)

## 3. Verification

### Tests
- [x] 3.1 Add guards (b) same-burst rejection keeps error and (c) failed reconcile keeps error; show each failable by its named mutation
- [x] 3.2 E2E: status and alert messages render in flow in the same mounted regions in the multi-field form; record region text before/after (AT announcement itself unmeasurable)
- [x] 3.3 E2E: per-kind height table before/after; only the multi-field form card changes (compact counter unchanged)
- [x] 3.4 Re-run full jest files, lint, typecheck, format check and the full e2e spec green (jest 3 workers, Playwright 2)
