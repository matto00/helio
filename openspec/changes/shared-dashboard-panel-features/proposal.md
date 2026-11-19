## Why

HEL-1773 (child 1) lets a named grantee open a dashboard shared with them, but hides every panel feature that reads through `/api/outputs/*` or `/api/pipelines/*`, because prod RLS (`outputs_select`) refuses those routes to a dashboard-only grantee. The dashboard-scoped per-panel routes (`/api/dashboards/:id/panels/:panelId/{rows,filter-capabilities,distinct-values,history,insight,provenance}`) already exist, gated by `authorizeResourceWithSharing`, and the public share viewer already uses them. HEL-1780 (scope "2a", owner ruling 2026-11-18) brings those features back for viewers and editors through those routes.

## What Changes

- Panel features on a dashboard the caller does not own read through the per-panel routes (no token; the signed-in grant admits): viewer control bar with distinct values; table header sort, column filters and quick search; cross-filter; history and compare sparklines; insight bodies; provenance; and the same in `PanelDetailModal` view mode.
- Owner ruling R4: for a grantee, sort/filter on the panel's own control columns goes to the server through the per-panel rows route; sort, column filters and quick search on any other column apply to the loaded rows in the browser, with the loaded-scope disclosure. The `PublicOutputControlScope` (C11) boundary does not move.
- Owner ruling R2: a cross-filter whose dimension is not one of the target panel's control columns narrows the loaded rows in the browser (client-fallback, existing disclosure).
- The caller's role is read per panel (from the panel's own `dashboardId`), so during a dashboard switch no request goes out under the other dashboard's role.
- The card-header Refresh button on an insight panel is hidden for non-owners (the manual insight refresh route refuses grantees).
- A user holding both a pipeline grant and a dashboard grant is treated by their role on the dashboard: on a non-owned dashboard they use the per-panel path.
- No new backend route and no migration expected. Backend specs prove each per-panel route for viewer/editor/stranger and RLS as `helio_app`; history payload rows stay unreachable for a dashboard-only viewer.

Out of scope: freshness/refresh line, run-completion signal, data-invalid badge (HEL-1786); warm tab cache restore (HEL-1783); editor Output binding section stays read-only (owner ruling R3).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-grantee-access`: non-owned dashboards gain controls, sort/filter, cross-filter, history, insight and provenance through per-panel routes; role read per panel.

## Impact

- Frontend: `features/panels` (PanelCardBody, PanelCard, PanelCardHeader, PanelFullscreenOverlay, MobilePanelStack, PanelDetailModal + usePanelDetailData, useCrossFilterServerOps, usePanelSortFilter, useOutputFilterCapabilities, useOutputHistory, InsightPanelBody/useInsight/CitationChip, ProvenanceTrigger/provenanceService, panelThunks non-owner branch, TableRenderer client sort/filter), `features/dashboards/state/dashboardAccessContext.tsx`, `features/dashboards/services/publicDashboardService.ts`.
- Backend: tests only (route specs + RLS transcript); no production code change expected.
- e2e: new `e2e/hel1780-shared-dashboard-panel-features.spec.ts`; existing `e2e/hel1773-viewer-grantee-dashboard.spec.ts` assertions that a feature is hidden for grantees are updated.
