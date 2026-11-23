## Standing Constraints

- [C1] Red first with mutations; commit the red run before implementation; run full spec files (lane C12).
- [C2] Scratch/tool output only in the main checkout's `.concertino/scratch/HEL-1618/`; hook TMPDIR per lane C13.
- [C3] Lane DB `helio_hel1618` for servers, Playwright, e2e cleanup and DB-touching jest/hooks; empty ANTHROPIC_API_KEY.
- [C4] jest 3 workers, Playwright 2 workers total, nice -n 19; never read or print any .env file.
- [C5] Owner ruling: forms min 5 rows on placement/resize (counter 4); no bump on load; sub-5 forms lift-when-free.

## 1. Frontend — split (behaviour-preserving)

- [x] 1.1 Record and commit before-counts for design D1's named jest/e2e proof set in `measurements.md`
- [x] 1.2 Split `FormPanelView.tsx` per design D1, no test edits; verify every file < ~400 lines, lint/typecheck pass
- [x] 1.3 Re-run the same specs; record after-counts in `measurements.md` equal to before; commit split alone

## 2. Frontend — non-owner stale-error clear

- [x] 2.1 Add the red-first test and the labelled guard test (design D2) to `FormPanelView.nonOwner.test.tsx`; commit red
- [x] 2.2 Implement D2 clear on the non-owner quiesce branch; verify tests green and a named mutation turns one red

## 3. Frontend — minimum-height measurement (then stop)

- [x] 3.1 Measure live at 1280 px, light and dark: 4-row 1/2/3-field forms and compact counter (panel h, scroller
      clientHeight/scrollHeight, hidden px, Submit visible?) into `measurements.md` with screenshots in evidence
- [x] 3.2 Report the measurements to the orchestrator and stop; fit work waits for the owner's option choice

## 4. Frontend — 5-row form minimum (design D3/D4)

- [x] 4.1 Commit the RGL no-bump probe test and its output in `measurements.md`
- [x] 4.2 Commit red tests: helper/createLayouts unit tests, `isSpaceBelowFree` tests, the Playwright resize spec (persisted h asserted), GUARD no-bump test
- [x] 4.3 Implement `FORM_MIN_ROWS`, the per-panel min lookup and the lift-when-free resize-stop rule; tests green
- [x] 4.4 Enumerate placement paths (incl. undo/redo) and form heights in `measurements.md`; fix any frontend path below 5 rows
- [x] 4.5 Run the named mutations (min 4; no counter exception; `Math.max(item.h, minH)` breaks the guard; lift w/o free check; no lift; lift as separate write); record outputs as evidence
- [x] 4.6 Re-measure live (1280 px, light/dark, Comfortable/Compact); before/after table in `measurements.md`

## 5. Tests

- [x] 5.1 Full jest for `features/panels/ui/form` and `ui/grid`, the form e2e proof set and the new spec green
