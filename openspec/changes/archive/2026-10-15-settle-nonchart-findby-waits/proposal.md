## Why

HEL-1599 removed the 1 s `findBy*` deadline race from every lazy-chart wait, but its measurements show the non-chart
waits in five panel test files (truncation note, table, metric, markdown) still race that deadline against the output
meta, rows and history mock promises: a ~1.2 s injected stall turns them red 5/5. Under a CI main-thread stall they can
flake the same way HEL-1596's crossFilter test did, turning unrelated PRs red.

## What Changes

- Add a sibling test helper under `frontend/src/test/` (or extend `settleChartMount.ts`) that awaits given mock results /
  promises inside `act` without the lazy `ChartPanel` import, so non-chart targets can be settled and then queried
  synchronously.
- Convert every listed non-chart `findBy*` wait in `PanelContent.chartTruncation`, `PublicDashboardViewerPage.truncation`,
  `PanelCard.crossFilter`, `PanelFullscreenOverlay.test` and `PanelContent.test` (and any other `findBy*` in those files
  that races a mocked promise) to settle-then-`getBy*`.
- Re-probe `PanelFullscreenOverlay.truncation` and `PanelDetailModal.truncation`; convert only if exposed.
- Record red-before / green-after evidence per file (HEL-1596 injected stall) in `measurements.md`.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — test-only; `skip_specs: true`)

## Impact

- `frontend/src/test/` (helper), the five test files above, possibly the two truncation files.
- No product code, API, schema or user-visible change.

## Non-goals

- Raising any `findBy`/`waitFor` timeout or adding retries.
- Sweeping non-chart `findBy*` waits in test files outside the HEL-1599 "Left" list (a repo-wide sweep is a separate ticket).
- Changing production `React.lazy` splits (`ChartRenderer`, `MarkdownRenderer`).
- Finding the natural source of CI main-thread stalls.
