## Why

A dashboard-only grantee gets `contentUpdatedAt` from `GET /api/dashboard-changes` but `dataUpdatedAt: null` and
`outputs: []`: the data query runs in the caller's RLS context and joins `outputs`/`output_snapshot_history`, which a
dashboard grant alone cannot read. So a shared tab never shows the "changed" dot for new pipeline data, and the warm
tab cache (deliberately disabled for non-owned dashboards by HEL-1773, moved here from HEL-1780 by owner ruling) has no
per-Output data times to validate against.

## What Changes

- `GET /api/dashboard-changes`: for every dashboard the caller can read (RLS decides, unchanged), `dataUpdatedAt` and
  `outputs[]` cover every Output bound to one of that dashboard's panels, read after the dashboard access check. Only
  Output ids the dashboard's panel list already returns to the caller, and capture times the per-panel history and
  `panel-status` routes already return, are reported.
- The open-tab "changed" dot then reacts to new data on shared dashboards (no client rule change).
- The warm tab cache keeps and restores shared dashboards: panel list plus row windows only (no Output metadata, no
  run baselines), restored with the per-panel read scope, re-read only through per-panel routes; a restored panel
  whose data advanced after its window was captured refreshes through the per-panel rows route.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-change-signals`: data times cover all panel-bound Outputs of a readable dashboard, owned or shared.
- `dashboard-tabs`: warm cache and reload restore apply to shared dashboards through per-panel reads.
- `dashboard-grantee-access`: a panel restored from the warm cache baselines its run-finish refresh on its restored rows.

## Non-goals

- Public share-link viewer; no new route; no migration; no change to `panel-status`, per-panel or Output routes.
- Owner warm behaviour (Output metadata, run baselines) is unchanged.
- Home shelf UI changes (it reuses the same service and simply gains shared data times).

## Impact

Backend: `DashboardChangesRepository` (+ its spec, an RLS spec as `helio_app`). Frontend: `features/dashboards/tabs/warm/*`,
`panelStatusStore` (restore baseline seed), tests; new e2e `e2e/hel1783-shared-dashboard-tabs.spec.ts`.
