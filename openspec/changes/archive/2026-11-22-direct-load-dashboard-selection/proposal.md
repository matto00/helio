## Why

On a page load the dashboards reducer auto-selects the most recently updated dashboard as soon as `fetchDashboards` resolves; the URL's dashboard (`/dashboards/:id`) or the saved active tab is applied only afterwards (by `DashboardRoute`'s effect, and by `hydrateTabs` after its bounded warm-restore wait of up to 3 s). For that window `selectedDashboardId` holds a dashboard the user never asked for. HEL-1575 hit a react-grid-layout loop through exactly this switch and worked around it by keying the skeleton grid; the transient selection itself remains (HEL-1624).

## What Changes

- On the load that has no prior selection, `fetchDashboards.fulfilled` selects the load target directly: the `/dashboards/:id` deep link when that dashboard is in the list, else the saved active tab (when the signed-in user's saved tab set names one that exists), else the existing most-recent default. The target is computed with the same rule `planHydration` already uses, so hydration's later `setSelectedDashboardId(plan.target)` is a no-op write of the same value.
- A stored empty tab set (the user closed every tab) keeps today's final outcome (no selection) and no longer passes through the most recent dashboard first.
- Existing selection preserved on refetch, exactly as today.
- No backend, schema or migration change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `frontend-dashboard-selection-flow`: the default selection on load prefers the deep-linked dashboard and the saved active tab over the most-recent dashboard, and never selects a different dashboard first.

## Impact

- `frontend/src/features/dashboards/state/dashboardsSlice.ts` (`fetchDashboards` thunk / `fulfilled` reducer).
- `frontend/src/features/dashboards/tabs/hydrateTabs.ts` (`planHydration` reused or a shared pure target helper extracted; behaviour unchanged).
- Tests: new selection-recording jest test(s) and an e2e request-log assertion; existing HEL-1575 tab hydration tests must stay green.
