## Why

Output panels have author-configured controls (HEL-1189) and a filter/distinct-values API
(HEL-1188), but nothing lets a *viewer* actually use them. Separately, Planning found the public
dashboard viewer renders no panel content at all today (title/kind only) — the owner ruled
(2026-09-29) to fold that prerequisite into this same change rather than split it off, so the
public-dashboard acceptance criterion is not silently dropped or deferred.

## What Changes

- Render each output panel's configured controls (date range/dropdown/numeric range/text) for
  viewers, on every render path: desktop grid, mobile panel stack, fullscreen overlay, detail
  modal, and public dashboards.
- Encode each panel's control selection in the URL (`?p.<panelId>.<controlId>=...`); reload and a
  pasted link reproduce it; clearing returns to the author's default; it never writes panel config.
- Apply the selection as HEL-1188 operators on `GET /api/outputs/:id/rows`, composed with the
  panel's own HEL-1027 sort/filter; pagination resets coherently; counts/`hasMore` describe the
  filtered set; reuse HEL-1027's request-sequencing guard against stale responses.
- Chart panels: controls filter chart reads too (single first-page read, same as today) — stated
  explicitly, not left implicit.
- **Fold-in (owner ruling):** give `PublicDashboardViewerPage` real panel content — reusing the
  authenticated `PanelContent`/`TableRenderer`/chart renderers where feasible — then extend
  controls, URL state, and server filtering to that path too, sequenced content-first so each
  layer is evaluator-verifiable red-first.
- Extend the public/optional-auth route tree with the sort/filter and distinct-values support
  viewer controls need there, strictly scoped server-side to the columns the author actually
  configured as controls on the panel being read — never a caller-supplied output id or column.

## Capabilities

### New Capabilities
- `output-panel-viewer-controls`: viewer control-bar rendering, URL-state encoding, server-filter
  composition/precedence with in-panel sort/filter, chart-panel behavior, a11y.
- `public-dashboard-panel-content`: real Output-row rendering (table/chart, reused renderers) on
  the public/anonymous dashboard viewer — the folded-in prerequisite `output-panel-viewer-controls`
  builds on for the public path.

### Modified Capabilities
- `public-dashboards`: adds sort/filter to the public rows route, and panel-scoped
  filter-capabilities/distinct-values equivalents, gated to columns the panel's own author-config
  actually declares as controls, reusing the existing share-token/membership ACL.

## Impact

- Backend: `PublicDashboardRoutes.scala`, `OutputService`/`OutputRowsQuery` reuse, new panel-scoped
  capability/distinct-values resolution.
- Frontend: `PublicDashboardViewerPage.tsx` (content rendering), a new viewer control-bar component
  wired into `PanelCard`/`MobilePanelStack`/`PanelDetailModal`/fullscreen, URL-state hook,
  `usePanelSortFilter`-adjacent composition with the new control state.
- No DB migration expected (URL-held, ephemeral, no persisted state) — confirmed in design.md.
