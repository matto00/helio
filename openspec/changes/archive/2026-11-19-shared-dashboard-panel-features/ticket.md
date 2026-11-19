# HEL-1780: Shared dashboards: panel controls, cross-filter, history, insight and provenance through per-panel routes

## Description

Child 2 of HEL-1773. HEL-1773 lets people open dashboards shared with them. On a dashboard they don't own, their app reads panel rows only through the per-panel routes. Every feature that calls `/api/outputs/*` or `/api/pipelines/*` is hidden, because RLS (`outputs_select`) refuses those routes to someone with only a dashboard grant. This ticket brings back, for viewers and editors, the features that the existing per-panel routes can serve.

Scope was restated by owner ruling on 2026-11-18 (escalation HEL-1780-1795065977186-39dcb8, answered via chat): this lane is "2a". The freshness/refresh line (`useDashboardMeta`), the dashboard-scoped run-completion signal (`usePanelRunRefresh`) and the data-invalid / assertion badge moved to HEL-1786. Warm tab cache restore moved to HEL-1783. The editor Output binding section stays read-only as HEL-1773 shipped it (no follow-up).

## Acceptance criteria (restated scope, 2a)

- On a dashboard the caller doesn't own, these work through per-panel routes (`/api/dashboards/:id/panels/:panelId/...`) and never through `/api/outputs/*` or `/api/pipelines/*`:
  - Filter and sort controls: the viewer control bar, filter capabilities, distinct values, and rows with sort and filter.
  - Cross-filter. The per-panel route accepts only a panel's own control columns. Owner ruling: when the cross-filter dimension is not one of the target panel's control columns, the target panel narrows its loaded rows in the browser, with the existing loaded-scope disclosure (client-fallback).
  - History and compare sparklines.
  - Insight panel bodies.
  - Provenance.
- `PanelDetailModal` view mode for a non-owner shows the viewer controls, distinct values and provenance, through per-panel routes.
- The card-header "Refresh <title>" button on a grantee's insight placeholder does nothing today (the manual insight refresh route 404s for grantees). Hide it for non-owners, or give it a grantee-safe job.
- During a dashboard switch, no request goes out under the wrong role. The role is read per dashboard (or per panel), not from whichever dashboard is currently active.
- Users who hold both a pipeline grant and a dashboard grant are tested.
- An e2e as a dashboard-only viewer and as an editor exercises each feature above and asserts no request goes to `/api/outputs/` (or `/api/pipelines/`).
- A dashboard-only viewer still never reaches history payload rows (HEL-921 premise). `/api/outputs/:id/history/:point/rows` stays unreachable, and no per-panel payload route is added.
- RLS checked as the non-BYPASSRLS `helio_app` role (as `DashboardSharedListRoutesSpec` does); every per-panel route used is proven with a stranger 404.

## Out of scope

- Freshness/refresh line, run-completion signal, data-invalid badge: HEL-1786.
- Warm tab cache restore for shared dashboards: HEL-1783.
- Editor Output binding section (picker, "Used on N dashboards"): stays read-only.
