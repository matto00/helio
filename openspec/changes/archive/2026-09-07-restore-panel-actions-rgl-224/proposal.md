## Why

Dependabot PR #481 (`react-grid-layout` 2.2.3 -> 2.2.4) deterministically fails two accessibility-tree assertions in
`frontend/src/app/App.test.tsx`, holding the bump open. The failure is real and reproducible, but the mechanism had to be
established before anything was changed: an unreachable-by-accessible-name action is exactly the defect class HEL-1003
spent nine gate rounds on, and "fix" attempts that weaken the query turn a live signal into a silent regression.

## What Changes

- Adopt `react-grid-layout` 2.2.4 in `frontend/package-lock.json`, superseding Dependabot PR #481.
- Repair the jsdom width stub in `frontend/src/test/jest.setup.ts`, which is coupled to 2.2.3's measurement API
  (`node.offsetWidth`) and goes silently ineffective under 2.2.4, which reads `getComputedStyle().width` instead.
- Add a mutation-proven regression guard that fails when the panel-actions accessible name is absent, and a guard that
  fails if the width stub stops producing a desktop-width measurement through react-grid-layout's real hook.
- Leave the two `App.test.tsx` assertions, `PanelCard.tsx`, `ActionsMenu.tsx` and `PanelGrid.tsx` unmodified.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. No product behavior changes: the defect is confined to the test harness's width stub plus a dependency version.
`skip_specs: true` is set in `.openspec.yaml` accordingly.

## Non-goals

- Adding a panel-actions affordance to `MobilePanelStack`. The phone stack is deliberately read-only (HEL-301); changing
  that is a product decision well outside a dependency-bump bug.
- Introducing committed Playwright/e2e infrastructure. This repo has none; real-browser verification uses the existing
  Playwright MCP + worktree dev-server review pattern.
- Touching table-panel sort/filter/pinning code, which a concurrent lane owns.

## Impact

- `frontend/package-lock.json` (dependency version 2.2.3 -> 2.2.4) and `frontend/src/test/jest.setup.ts` (the
  `getComputedStyle` width shim), plus new guard tests. No product code changes.
- `frontend/package.json` is deliberately NOT changed: its `^2.2.2` range already admits 2.2.4 and Dependabot #481 is
  itself lockfile-only. The probe install during Planning widened it to `^2.2.4`; task 1.1 reverts that.
- Unblocks Dependabot PR #481, which can be closed as superseded once this merges.
