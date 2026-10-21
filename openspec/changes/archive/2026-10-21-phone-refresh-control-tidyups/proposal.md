## Why

HEL-1656 shipped pull-to-refresh as the only way to refresh the phone dashboard stack. A path gesture with no single-pointer alternative fails WCAG 2.5.1 (Pointer Gestures), and keyboard and switch users cannot refresh at all. The same PR left three small defects in the pull indicator and stack (a CSS/JS constant kept in sync by a comment, a wrong label during the post-refresh settle, and a pre-existing chart card that sometimes stays collapsed under Full motion), plus one desktop e2e flake seen during its full-suite run.

## What Changes

- A visible, icon-only **Refresh dashboard** button on the phone dashboard (viewport 768px and below), keyboard- and single-tap-operable, that triggers the same once-per-output-bound-panel refresh fan-out as the pull, shares its busy state, and never runs a pipeline. Rendered only while at least one output-bound panel is mounted. Desktop is unchanged.
- The pull indicator no longer shows "Pull to refresh" while the stack settles back after a refresh; it shows "Refreshed".
- `--pull-indicator-height` and `PULL_HOLD_PX` get one source of truth enforced by a guard test.
- The phone-stack chart card that sometimes stays collapsed under Full motion is root-caused and fixed (or, if not reproducible within the debug budget, measured and documented).
- `hel1575-dashboard-tabs.spec.ts:593` is triaged (test-side fix only if small; otherwise documented as a follow-up candidate).
- DESIGN.md §12 (and §10 where the pull is described) records the refresh button.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `mobile-dashboard-pull-refresh`: adds a single-pointer/keyboard refresh control that shares the pull's fan-out and busy state; adds the post-refresh settle label. (The chart-card item 2 is a bug fix or measurement with no requirement change.)

## Impact

- Frontend only: `frontend/src/features/panels/ui/grid/` (MobilePanelStack, PullRefreshIndicator, pullRefreshRegistry, CSS), `frontend/src/app/dashboardMeta/DashboardRefreshLine.tsx` (+ CSS), `frontend/src/features/panels/ui/PanelList.tsx`, `frontend/src/shared/motion/usePullToRefresh.ts`, the chart card path found by investigation, new jest tests and a new e2e spec; possibly `e2e/hel1575-dashboard-tabs.spec.ts` (test-only).
- No backend, API, schema or migration change. Desktop rendering unchanged.
