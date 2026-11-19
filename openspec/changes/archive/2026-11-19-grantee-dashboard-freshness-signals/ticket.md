# HEL-1786: Shared dashboards: freshness line, run-finish refresh and data-invalid badge through grantee-safe routes

## Description

Split out of HEL-1780 by owner ruling (2026-11-19). On a dashboard the user doesn't own, HEL-1773 hides three features because each reads routes a dashboard-only grantee is refused (`/api/outputs/*`, `/api/pipelines/*`; prod RLS `outputs_select`):

* the "data as of" freshness and refresh line (`useDashboardMeta`). The panel list already carries a per-panel `dataAsOf`;
* refreshing panels when a pipeline run finishes (`usePanelRunRefresh`, which uses `/api/pipelines/:id/run-events`);
* the data-invalid / assertion badge (`useDataInvalid`).

## Acceptance criteria

* Each feature works for dashboard viewers and editors through a route scoped to the dashboard or panel, never through `/api/outputs/*` or `/api/pipelines/*`.
* Every new route re-checks access per dashboard/panel; a stranger gets 404; RLS is proven as the NOBYPASSRLS test role (as `DashboardSharedListRoutesSpec` does).
* The run-finish signal reveals nothing beyond what the grantee's panels show (no pipeline ids, step names, errors or owner ids).
* An e2e as a dashboard-only viewer and editor exercises each feature and asserts no request to `/api/outputs/` or `/api/pipelines/`.
* Tests that fail first.

## Agent notes

* HEL-1780 premise check: `.concertino/runs/HEL-1780/evidence/premise-validation.md`. Existing per-panel routes: `PublicDashboardRoutes.scala` (`authorizeResourceWithSharing`).
* This run's premise check: `.concertino/runs/HEL-1786/evidence/premise-validation.md` (verdict no-drift).
