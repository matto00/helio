## Why

HEL-1773 hid the dashboard freshness line, the run-finish panel refresh and the data-invalid badge on dashboards the caller does not own, because each reads `/api/outputs/*` or `/api/pipelines/*`, which a dashboard-only grantee is refused (prod RLS `outputs_select`). HEL-1780 restored every other panel feature through per-panel routes; these three need a dashboard-scoped source that does not exist yet (HEL-1786, owner ruling 2026-11-19).

## What Changes

- New authenticated route `GET /api/dashboards/:id/panel-status`: per Output panel of the dashboard, the bound pipeline's last run time and status (`succeeded`/`failed`), and whether the panel's Output is data-invalid (an error-severity assertion failed on the latest non-dry run), plus the dashboard's distinct source names. Authorized per dashboard (owner, editor or viewer grant; stranger 404). Carries no pipeline, step, run, Output or owner id and no error text.
- On a dashboard the caller does not own, the client:
  - shows the desktop meta-row refresh fact and sources, and the phone "refreshed" caption, from that route (the grantee's source list is the sources feeding the dashboard's Outputs, so it can be a subset of the owner's list, which names every root of every feeding pipeline);
  - polls that route while the page is visible and refreshes a panel's rows (through the per-panel rows route) when that panel's latest stored-data capture time (the Output's newest history point, committed with the rows) advances;
  - shows the "Invalid data" badge on a panel from that route.
- Owner behaviour is unchanged (still Output/pipeline routes and the run-events stream).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-grantee-access`: adds requirements for the grantee freshness line, run-finish refresh and data-invalid badge, and for the dashboard panel-status route's access and disclosure rules.

## Impact

- Backend: new route file under `api/routes/dashboards/`, a small resolver/service reading through system context after the dashboard ACL, response protocol, wiring in `ApiRoutes.scala`; JSON Schema in `schemas/dashboards/`. No migration. `PublicDashboardRoutes.scala` is not touched (sibling lanes HEL-1784/HEL-1781 may touch it); `ApiRoutes.scala` gets one wiring line.
- Frontend: a module-scoped, ref-counted panel-status store and hooks in `features/panels`; `DashboardMetaRow`, `DashboardRefreshLine`, `PanelCard`, `PanelCardBody` (and therefore `MobilePanelStack`/fullscreen paths that reuse them) consume it in panel scope.
- Tests: backend route spec under `helio_app` (NOBYPASSRLS), jest, new e2e for viewer and editor.
