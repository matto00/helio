# Files modified — HEL-572 chart-click-drilldown

Resolved live via `scripts/concertino/resolve-review-base.sh` against
`main`/`origin` (`BASE_SHA=e195481a46e026a32a4aa189487cdd4a8b78f9e2`).

## New source files

- `frontend/src/utils/chartClickSelection.ts` — the click→column mapping
  (`mapChartClickToSelection`), row filter (`filterRowsForSelection`), and
  their shared column-resolution helpers (`resolveDataColumns`,
  `resolvePieValueColumn`), plus the `ChartInspectConfig`/`ChartClickSelection`
  types. Deliberately kept free of any `echarts`/`echarts-for-react` runtime
  import (only a type-only `ChartType` import from `chartAppearance.ts`) so
  `PanelCard.tsx`/`PanelFullscreenOverlay.tsx` (eagerly bundled) can import it
  for row-filtering without pulling `ChartPanel.tsx`'s lazy-loaded echarts
  chunk into the main bundle — see `ChartRenderer.tsx`'s pre-existing HEL-512
  comment for why that boundary is load-bearing (confirmed preserved: the
  production build still emits `ChartPanel-*.js` as its own chunk, separate
  from `index-*.js`).
- `frontend/src/features/panels/ui/PanelInspectView.tsx` — the
  click→selection→inspect view (design.md D5): wraps `Modal` directly (not
  `PanelDetailModal`), reads the panel's current selection from Redux
  (`interactionState[panelId]`), filters rows via `chartClickSelection.ts`,
  renders `DataGrid` + a truncation notice + a clear/return control, and an
  `EmptyState` when nothing is selected.
- `frontend/src/features/panels/ui/PanelInspectView.css` — its styling
  (truncation-notice surface, body layout).

## New test files

- `frontend/src/utils/chartClickSelection.test.ts` — unit tests for the
  click→column mapping (bar/line single-series, multi-series
  `fieldMapping.series`-grouped, auto-detected multi-series, pie
  mapped-y/auto-detected, scatter grouped/ungrouped/shared-x), the row
  filter, and the mapping/row-filter agreement regression guard (tasks
  2.2–2.5).
- `frontend/src/features/panels/ui/ChartPanel.click.test.tsx` — a dedicated
  file (kept separate from the already-oversized `ChartPanel.test.tsx`, see
  "Spinoff candidates" below) covering the `componentType === "series"`
  bail-out, `stopPropagation` timing/ordering, and the `cursor: "pointer"`
  affordance including the HEL-1178 no-appearance case (tasks 3.1–3.3).
- `frontend/src/features/panels/ui/PanelInspectView.test.tsx` — header text,
  truncation-notice visibility, exact-row-matching, the empty state, and the
  `onClose`/`onClear` split (tasks 4.1, 4.2, 4.4).
- `frontend/src/features/panels/ui/PanelCard.inspect.test.tsx` — a dedicated
  integration-test file covering the grid click→inspect flow and the
  ActionsMenu "Inspect" item (with-selection, no-selection, non-chart-eligible
  gating) (tasks 4.2, 5.1).
- `e2e/hel572-chart-click-drilldown.spec.ts` — live-browser coverage of what
  only a real browser can prove: the keyboard-only ActionsMenu flow with
  focus landing inside the dialog (task 5.2), Inspect nested inside
  Fullscreen with Escape closing only the topmost native `<dialog>` (task
  4.3), and the HEL-1178 regression probe with no stored `appearance.chart`
  (task 6.5). Run via `scripts/concertino/start-servers.sh` against
  `DEV_PORT=6004`/`BACKEND_PORT=8911`; passed twice in a row (not flaky).

## Modified source files

- `frontend/src/features/panels/types/panel.ts` — added the
  `SelectionDescriptor` type (design.md "SelectionDescriptor field
  semantics").
- `frontend/src/features/panels/state/panelsSlice.ts` — added
  `interactionState` to `PanelsState`, the `selectDataPoint`/`clearSelection`
  reducers, and clearing in `fetchPanels.pending` (dashboard switch) and
  `deletePanel.fulfilled` (panel delete).
- `frontend/src/utils/chartAppearance.ts` — added the exported
  `resolveChartType(chart)` helper (the same `chart?.chartType ?? "line"`
  fallback `appearanceToEChartsOption` already computed inline, extracted so
  `ChartPanel`'s click handler and `PanelCard`/`PanelFullscreenOverlay`'s
  inspect-view mounting resolve the SAME chart type without a second,
  divergence-prone copy).
- `frontend/src/features/panels/ui/ChartPanel.tsx` — extracted column
  resolution into `chartClickSelection.ts` (task 2.1), added
  `withPointerCursor` wrapping `buildDataOption`'s result (D6), added the
  `onDataPointSelect` prop and the `onEvents.click` handler (D2/D3).
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — threads
  `onDataPointSelect` through to `ChartPanel`.
- `frontend/src/features/panels/ui/PanelContent.tsx` — threads
  `onDataPointSelect` through `PanelContentProps`/`OutputPanelContent` to
  `ChartRenderer` (chart-kind output panels only).
- `frontend/src/features/panels/ui/PanelCard.tsx` — a second, independent
  `useOutputMeta(outputId)` call (design.md D5's own rationale: computed once
  here rather than re-fetched by `PanelFullscreenOverlay`, which is mounted
  unconditionally) deriving `chartInspectConfig`; new
  `isInspectOpen`/`handleDataPointSelect`/`handleCloseInspect`/
  `handleClearInspect`/`handleOpenInspectFromMenu` state and handlers; the
  ActionsMenu "Inspect" item (chart-eligible only); mounts its own
  `PanelInspectView` (grid, `variant="preview"`); passes
  `onDataPointSelect`/`chartInspectConfig` down to `PanelCardBody`/
  `PanelFullscreenOverlay`.
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx` — accepts
  `chartInspectConfig` as a prop (not its own fetch — see the `PanelCard.tsx`
  note above); owns its own `isInspectOpen` local boolean and
  `handleDataPointSelect`/`handleCloseInspect`/`handleClearInspect`; mounts
  its own `PanelInspectView` (`variant="full"`), nested inside the Fullscreen
  `Modal`'s children (native dialog stacking, design.md Context).

## Modified test / test-infrastructure files

- `frontend/src/test/renderWithStore.tsx` — added `interactionState: {}` to
  the preloaded `panels` state the shared test helper builds (a genuine gap:
  this was missing before this ticket's `PanelsState.interactionState` field
  existed, and would have thrown at runtime — `state.panels.interactionState[
  panelId]` on `undefined` — for any `renderWithStore`-based test mounting a
  component that reads it, not just this ticket's new ones).
- `frontend/src/features/panels/state/panelsSlice.test.ts` — added
  `interactionState: {}` to three hand-built `PanelsState` preloaded-state
  literals (typecheck caught these; `PanelsState` requires the field now);
  added the `selectDataPoint`/`clearSelection` reducer tests and the
  delete/dashboard-switch clearing tests (tasks 1.2, 1.3).
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — same
  `interactionState: {}` addition (typecheck caught this one too).
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.test.tsx` — added
  `chartInspectConfig: null` to the shared `basePanelDataProps` fixture
  (typecheck caught the new required prop); no behavior change to any
  existing assertion.
- `frontend/src/theme/elevationTokenGuard.css.test.ts` — bumped the pinned
  CSS-file-count assertion 118 → 119 (`PanelInspectView.css` is a new file;
  its one `border-radius` declaration uses a token, not a literal, so it
  produced zero new hits and needed no new exception-list pin, only the
  count bump — same pattern as the existing "HEL-584 added
  PanelFullscreenOverlay.css" comment each file already carried).
- `frontend/src/theme/motionTokenGuard.css.test.ts` — same 118 → 119
  CSS-file-count bump as `elevationTokenGuard.css.test.ts` above, same
  reason.

## Root cause / probe record (systematic-debugging.md — e2e spec construction, not a production defect)

**Symptom:** the first run of `e2e/hel572-chart-click-drilldown.spec.ts`'s
fullscreen-stacking test clicked the chart canvas and got `PanelDetailModal`
("Customize") instead of Inspect — looked exactly like a `stopPropagation`
failure.

**Root cause:** the TEST fixture, not the implementation. `POST /api/pipelines/
:id/outputs`'s `config.chartType` (set on the Output) is never read for
rendering — only the PANEL's `appearance.chart.chartType` is
(`ChartPanel.tsx`, defaulting to `"line"` when unset). The spec never set
`appearance.chart`, so the panel rendered as the default LINE chart while the
click coordinates were computed assuming a PIE chart's geometry (a large
filled area, reliably clickable without knowing exact layout) — the computed
point landed on blank canvas space with no series element under it, so
`componentType` was `undefined`/not `"series"` and the click correctly did
NOT call `stopPropagation`, correctly falling through to
`DesktopPanelGrid`'s `article onClick` — exactly the D2 bail-out behavior
working as designed, just triggered by a bad test click target.

**Probe:** a throwaway probe spec (deleted after use) that PATCHed the
panel's `appearance.chart.chartType` to `"pie"` before the same click,
otherwise identical. `inspectVisible=false, customizeVisible=true` before
the PATCH; `inspectVisible=true, customizeVisible=false` after — confirming
the hypothesis and ruling out a real `stopPropagation`/bubbling defect.

**Fix:** the spec now `PATCH`es `appearance.chart` (`chartType: "pie"`)
after creating the panel, documented inline at the call site with this same
root-cause note.

## Follow-up candidates (not filed as Linear tickets — flagging per role
instructions to surface rather than file directly; driver/orchestrator to
triage per Standing Constraint C10)

- `ChartPanel.tsx` was already ~514 lines (well over CONTRIBUTING.md's
  ~400-line propose-a-split threshold) before this ticket added click
  wiring/cursor logic, and is now ~610 lines. This ticket extracted the
  reusable pure-function half into `chartClickSelection.ts` (which also
  reduced `ChartPanel.tsx`'s OWN net growth versus inlining), but the file
  itself still warrants a structural split (e.g. the appearance/option-
  assembly `useMemo` body is the single largest remaining block) — flagged
  rather than done here per "Keep refactors behavior-preserving" /
  "avoid unrelated refactors."
- `ChartPanel.test.tsx` is ~1100 lines. New click/cursor tests were added to
  a new sibling file (`ChartPanel.click.test.tsx`) specifically to avoid
  growing it further, but the original file itself is a pre-existing
  candidate for splitting by concern (appearance mapping vs. data-option
  assembly vs. compact-mode vs. theme-sync).
- HEL-588 (cross-filtering, blocked on this ticket) will need to decide how
  a sibling panel reacts to `interactionState` changing for a DIFFERENT
  panel — this ticket deliberately leaves that entirely unaddressed (Non-Goal),
  but the `PanelCard`/`PanelFullscreenOverlay` prop-threading pattern this
  ticket established (`chartInspectConfig` computed once, threaded down)
  is probably the shape HEL-588's own cross-panel read will want to follow.
