## Standing Constraints

- [C1] Any e2e wait whose semantics change is shown red under a width-delivery-delaying probe before the fix and
  green after; a pure refactor needs only same-result evidence. Never claim an unobserved red.
- [C2] `useLayoutSave.ts` and `dashboardsSlice.ts` are not modified; `useLayoutSave` is called only from
  `DesktopPanelGrid.tsx`; existing unit test files are not edited to make the split pass.
- [C3] `useLayoutSave`'s outputs reach extracted hooks as plain arguments, never via refs; the commit-flag cleanup
  effect stays declared before the `useLayoutSave` call.

### Frontend

## 1. Audit

- [x] 1.1 Classify every `setViewportSize` site in `e2e/` (migrate / leave + reason) into `audit.md` in this change dir; verify by grep count matching the table rows

## 2. Shared e2e helper

- [x] 2.1 Add `e2e/support/gridProcessedWidth.ts` (`waitForGridWidth`, D1; timeout message carries the observed value); verify `npm run check:e2e-types` + lint
- [x] 2.2 Migrate hel1023 `settledRects` to the helper, keeping its box poll as an assertion (D1 option a); verify the spec passes
- [x] 2.3 For hel1392-burst AND every other spec 1.1 marks migrate: red-probe the OLD wait under a delayed-ResizeObserver init script before editing; record per spec in `evidence.md` (red, or "no red obtained" + observation)
- [x] 2.4 Migrate hel1392-burst `crossTo` (and any spec 1.1 marked migrate) to the helper; verify green under the same probe and without it
- [x] 2.5 Grep proof in `evidence.md`: `grep -rn -- '--panel-grid-processed-width' e2e | grep -v e2e/support/gridProcessedWidth.ts` (expect 0) and `grep -rnE "panel-grid['\"]\)?\.boundingBox|panel-grid.*getBoundingClientRect|container\??\.w" e2e` with each hit listed + reason (allowed: hel1023 readRects box assertion, hel1028 l.185 pre-load container-range assertion)

## 3. DesktopPanelGrid split

- [x] 3.1 Extract `usePanelTitleEditing`, `usePanelDetailState`, `useProcessedWidth` (D4); verify DesktopPanelGrid tests green
- [x] 3.2 Extract `useCommitFlag` (before `useLayoutSave`) and `useGridLayoutInteraction` (after, plain-argument inputs) (D4); record before/after hook+effect order with line numbers in `evidence.md`; verify PanelGrid unmount-flush test green
- [x] 3.3 Confirm `DesktopPanelGrid.tsx` < ~250 lines and `git diff --stat` shows no change to `useLayoutSave.ts`/`dashboardsSlice.ts`/test files

## 4. Archived evidence nits

- [x] 4.1 HEL-1413 `evidence.md`: reword l.18 only to "all 8 at lg geometry, 4 outside md bounds" (source: archived skeptic-final-1.md l.10-15); leave l.24 and l.28 (`bad=4/8` probe output) unchanged; residue nit: window end 16:04:07 (newest row of dev-db-residue.txt), keep 16:22:40 only as the query bound; verify hygiene hook passes

### Tests

## 5. Verification

- [x] 5.1 Run all `frontend/src/features/panels/ui/grid` + `panels/hooks` jest tests (3 workers, nice -n 19) and report counts
- [x] 5.2 Run every migrated e2e spec (Playwright, ≤2 workers) and report pass counts; record user cleanup by exact (id, email)
