# HEL-1704 evidence

## 1.1 Baseline (unmodified code, main a6499da12 + this change's artifacts)
- jest `features/pipelines`: Test Suites 183 passed, Tests 2964 passed.
- e2e hel1631, hel1684, hel1685, hel1705 (2 workers): 45 passed.

## 1.2 / 5.1 Guards and recorded mutations
- `usePipelineDetailPage.keys.test.tsx` (key sets recorded on main before the split): removing `estimatedRows` from the composer's return turned it red (1 failed, 1 passed); restored.
- `draftSaveRequest.test.ts` (characterization guards): changing `replay.dropped > 0` to `> 5` and the `"A step"` fallback to `"A stepX"` turned 2 tests red (2 failed, 5 passed); restored.

## 4.1 Red first (e2e/hel1704-narrow-preview-title.spec.ts on unmodified CSS)
900x600 dark: `title clipped by the preview's bottom` Expected <= 404, Received 415 (title 397-415 over a preview ending at 404). 900x700 passes on main (no-regression check). The assertion stops at the first failure, so light was not reached in the red run; main's table in design.md D4 records both themes identical.

## 4.2 After the CSS
Spec green at 900x700 and 900x600, light and dark (title inside preview and column, first condition row inside the editor, document does not scroll).

## 5.2 After
- jest `features/pipelines`: 184 suites, 2966 tests passed; full frontend jest: 778 suites, 9538 tests passed.
- e2e hel1631, hel1684, hel1685 (incl. addendum G), hel1705 and the new hel1704 spec: 46 passed.
- `npm run lint` exit 0, `npm run format:check` exit 0, `npm --prefix frontend run build` exit 0, `tsc --noEmit` clean.
- Screenshots: `e2e-evidence/HEL-1704/narrow-preview-900x{600,700}-{light,dark}.png` (gitignored).

## Notes
- `usePipelineDraftSettle.ts` carries a targeted `eslint-disable-next-line react-hooks/refs` on the render-time `stepParamRef` write; moved verbatim from `usePipelineDraftSave`, where the compiler lint rule did not analyze it. Candidate follow-up: replace the ref with a read at settle time (behaviour change, not done here).
- No bugs found during the split.
