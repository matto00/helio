## Standing Constraints

- [C1] Do not edit `OutputHistoryService`, history schemas, `PublicDashboardRoutes*`, L7 scrubber files, `ci.yml`, `playwright.config.ts`, `.gitignore`; no product-code change ships.
- [C2] Every new assertion is shown red under a PRODUCT mutation (reverted afterwards) and green on real code; the red line, mutation diff and green are recorded in the change dir (`mutation-evidence.md`).
- [C3] Local Playwright: at most 2 workers, `nice -n 19`, this run's own ports, own browser context; record exact ids of every user/row created; never `matt@helio.dev`; project-local npm cache, not committed.
- [C5] D1 asserts the public route's exact args ("dash-1", "panel-1", "tok"), with panel.id != outputId and the history cache/comparison store reset per test; never `expect.any(String)` in the panelId position.
- [C4] Never `pkill`/`pgrep`/`killall`; never select processes or rows by pattern or time window.

### Frontend

## 1. Frontend

- [x] 1.1 None (test-only change); verify with `git diff --stat` that no file under `frontend/src` other than the new test changes.

### Tests

## 2. Tests

- [x] 2.1 Add `PublicDashboardViewerPage.history.test.tsx` per design D1 (anon + authenticated owner); verify green with `npm test -- --testPathPatterns=PublicDashboardViewerPage.history`.
- [x] 2.2 Mutation-red 2.1 by removing the page's `historySource` prop; record red output, revert, record green.
- [x] 2.3 Add the D2 no-reload assertion (document-request count + window sentinel) to the editor->back step; verify green both themes.
- [x] 2.4 Mutation-red 2.3 by making the sidebar Dashboards link a full load; record red, revert.
- [x] 2.5 Add `resizeAndSettle` per D3 and use it for the 1440/1100 loop and restore; verify green both themes.
- [x] 2.6 Mutation-red 2.5 by freezing `PanelList.tsx`'s measured `gridContainerWidth` at its first RO-measured value; record new-wait red AND old-wait vacuous green; revert.
- [x] 2.7 Apply D4 (isolateLivePage, user-id log); record created user ids in `mutation-evidence.md`.
- [x] 2.8 Run lint, typecheck (frontend + e2e), Prettier and the full Jest suite; all green.
