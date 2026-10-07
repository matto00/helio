## Standing Constraints

- [C1] Focus-restoration fixes must be proven under React.StrictMode (dev double-invoke) as well as a single mount; a jsdom StrictMode test and a real-Chromium dev-server check are both required.

## 1. Scrubber names

- [x] 1.1 Add the shared precision helper to `formatCaptureTime.ts`, re-express `formatCapturePair` on it; existing `formatCaptureTime.test.ts` passes unmodified and new helper unit tests (0/1/2 neighbours, same minute, same second, identical) pass
- [x] 1.2 Use it in `HistoryScrubber.describe()` against both neighbours (identical instant -> ", run k of n"); add `OutputHistoryModal.test.tsx` cases asserting the slider's `aria-valuetext` differs between same-minute and same-second adjacent points, shown red against the old minute-only `describe()` with the red run's output recorded in evidence

## 2. Focus return

- [x] 2.1 Write design D2's failing tests (i)-(iv) in `Modal.test.tsx` (with the `showModal` stub moving focus into the dialog so StrictMode cases are not vacuous) plus a History-view-level test (open from the History button, close via Escape and via Close, focus is on the button); record the red output, the probe-confirmed root cause (both parts), and whether (i)-(iii) also fail on the pre-HEL-1277 Modal
- [x] 2.2 Implement D2 (a) capture guard and (b) close-then-restore on unmount-while-open in `Modal.tsx`; tests (i)-(iv) and the History-view test pass, the existing `Modal.test.tsx` suite passes
- [x] 2.3 Verify in a real Chromium browser on the worktree's dev server (own browser instance, not the shared Playwright MCP session; screenshots/evidence only under an absolute path in this worktree outside `openspec/changes/`): Escape and Close both leave `document.activeElement` on the History button

## 3. Comment and test

- [x] 3.1 Repoint the `OutputGalleryCard.css` comment to the archived measurements path; `test -f` that path passes
- [x] 3.2 Add the same-second metric-baseline "vs" test; shown red by mutation of `HistorySummary`'s comparison label

## 4. Gates

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, full `npm test` (under `nice -n 19`, max 3-4 workers) all pass
