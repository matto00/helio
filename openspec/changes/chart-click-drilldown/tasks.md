## 1. Selection state (Redux)

- [x] 1.1 Add `SelectionDescriptor` type (`panelId`, `dimension`, `value`, `series`) and `interactionState: Record<string, SelectionDescriptor | null>` to `panelsSlice`'s `PanelsState`; verify `frontend/src/features/panels/state/panelsSlice.ts` compiles under `npm run typecheck`.
- [x] 1.2 Add `selectDataPoint`/`clearSelection` reducers; verify a unit test dispatching each updates `interactionState[panelId]` correctly.
- [x] 1.3 Clear `interactionState` on `deletePanel.fulfilled` (per-panel) and on `fetchPanels.pending` (dashboard switch, matching `loadedDashboardId` reset); verify a unit test for each clear path (red-first: assert stale selection survives before the reducer change, then passes after).

## 2. Click → column mapping (per chart type)

- [x] 2.1 Extract the shared `xCol`/`yCol`/`seriesCol` index-resolution `buildDataOption` performs into a small helper both it and the new mapping function call; verify existing `ChartPanel` tests still pass unchanged (no behavior change, pure extraction).
- [x] 2.2 Implement `mapChartClickToSelection(params, chartType, fieldMapping, headers)` for bar/line single-series and multi-series, returning `{dimension, value, series}` per design.md D3's field semantics (`dimension` = mapped x-column name, `value` = clicked category, `series` = y-column name or clicked series name); verify unit tests per design.md D3 scenario (single-series: dimension+value+series all populated; multi-series: value+series-name, with a different series at the same x category NOT matched).
- [x] 2.3 Implement the pie branch (`dimension` = label column name, `value` = slice `name`, `series` = resolved value-column name); verify a unit test covering both the mapped-y and auto-detected-column pie cases.
- [x] 2.4 Implement the scatter branch (`dimension` = mapped x-column name, `value` = stringified clicked x value, `series` = clicked `colorField` group when grouped else the y-column name); verify a unit test with a color-grouped scatter dataset resolves the correct group, and a test confirming two points sharing an x value both resolve to the same `value`.
- [x] 2.5 Implement the shared row-filter helper (D4: `row[xCol] === value && (seriesCol === -1 || row[seriesCol] === series)` for bar/line/pie; numeric `parseFloat` x-equality plus optional color-column equality for scatter) consuming the same resolved column indices as 2.1; verify a unit test that click mapping (2.2-2.4) and row filtering agree on the same `value`/`series` for a shared fixture per chart type (regression guard against the two ever disagreeing).

## 3. Chart click wiring + cursor affordance

- [x] 3.1 Wire `onEvents={{click: handleClick}}` on `ChartPanel`'s `<ReactECharts>`; bail out unless `params.componentType === "series"`; verify a Playwright/unit interaction test that clicking the chart legend does NOT invoke the selection callback.
- [x] 3.2 On a genuine series click, call `params.event?.event?.stopPropagation()` before invoking the new `onDataPointSelect` prop; verify a test (red-first: without the stop, prove a click on a chart element currently also opens `PanelDetailModal`; green after) confirming a chart-element click does not open Customize.
- [x] 3.3 Add `cursor: "pointer"` to the returned series entries in `buildDataOption`, applying unconditionally (independent of `appearance?.chart`); verify a unit test rendering a chart panel with NO stored `appearance.chart` still shows the pointer-cursor series option (HEL-1178 hazard check).
- [x] 3.4 Verify no regression to tooltips/hover-emphasis (HEL-566): existing `ChartPanel` tooltip/hover tests still pass unchanged.

## 4. Inspect view

- [x] 4.1 Build `PanelInspectView` (wraps `Modal`, own component — not `PanelDetailModal`): header "Showing rows for {dimension}: {value}{ / series}" (e.g. "Showing rows for quarter: Q1 / Revenue"), truncation notice when `rowsTruncated`, `DataGrid` over the filtered rows, clear/return control; verify a component test for the header text and truncation-notice visibility (present/absent per `rowsTruncated`).
- [x] 4.2 Mount `PanelInspectView` from `PanelCard` (grid context, `DataGrid variant="preview"`), gated on chart-eligible panels; wire chart click → `dispatch(selectDataPoint(...))` + open; verify an integration test: clicking a chart element in the grid opens the view listing exactly the matching rows.
- [x] 4.3 Mount `PanelInspectView` from `PanelFullscreenOverlay` (`DataGrid variant="full"`), fed the same `panelData`; verify the same click→inspect flow works inside fullscreen, and that Escape while Inspect is open over Fullscreen closes only Inspect (native dialog stacking per design.md Context) — a Playwright test toggling both.
- [x] 4.4 Clear/return control closes the view and dispatches `clearSelection`; verify a test that after clearing, the selection descriptor is gone from `interactionState`.

## 5. Keyboard entry point

- [x] 5.1 Add an "Inspect" item to `PanelCard`'s `ActionsMenu` (chart-eligible panels only) that opens `PanelInspectView` for the panel's current selection, or an empty state when none; verify a component test for both the with-selection and no-selection cases.
- [x] 5.2 Verify keyboard-only flow end to end: open `ActionsMenu` via keyboard, activate "Inspect", confirm the view opens and focus lands inside it (reusing `Modal`'s existing focus-trap/restore — no new focus logic needed); verify via a Playwright keyboard-navigation test.

## 6. Full verification pass

- [x] 6.1 `npm run lint` — zero new warnings.
- [x] 6.2 `npm run typecheck` — passes.
- [x] 6.3 `npm test` — full suite green, including every unit/component test added above.
- [x] 6.4 Live-verify in both light and dark themes by toggling the theme WITHOUT navigating away (per standing constraint C9): chart cursor, inspect view styling, and the ActionsMenu Inspect entry all render correctly in both.
- [x] 6.5 Live-verify a chart panel with NO stored `appearance.chart` still gets clickable cursor + working inspect (HEL-1178 regression probe), per design.md D6.

## Standing Constraints

- [C1] Never `git add -A`; commit only intended files. `files-modified.md` lists EVERY touched file, fixtures included.
- [C2] Every `git commit` runs with Bash timeout 600000. Never re-run a commit while one is already in flight.
- [C3] Proof is red-first: for any bug fix, show the test failing without the change before showing it pass.
- [C4] Budget exhaustion (including DEBUG_ATTEMPTS) is a mandatory escalation to the human, never a self-approval.
- [C5] If a final-gate REFUTE is fixed with a code change, the evaluator MUST be re-run on the new HEAD before the final re-gate and before creating the PR — do not rely on the auditor to catch a stale PASS (CON-228 recurrence).
- [C6] Playwright screenshots go under `.concertino/runs/HEL-572/evidence/`, never the main checkout root.
- [C7] All artifacts (including premise-validation.md and planning docs) live inside the worktree or `.concertino/runs/HEL-572/`, never the main checkout root.
- [C8] One lane. Migration ledger: V110 is highest applied, V111 is free. Flag the driver if this ticket ends up taking a migration (not expected — frontend-only scope).
- [C9] Live-verify theme behaviour (light/dark) by toggling WITHOUT navigating away — navigating remounts components and can mask real bugs.
- [C10] Follow-ups are FILED (not just flagged in the PR body): origin_kind: followup, origin_ticket: HEL-572, relatedTo HEL-572, `Follow-up` label, v0.8 project `28f119e2-5738-46b1-a53b-42f73e06b053`. Run follow-up triage BEFORE cleanup.sh removes the worktree.
