## Why

`helio-news` (and every other agentic dashboard builder) has to reimplement the same
geometry — flowing `w × h` panel sizes into non-overlapping grid positions — because
Helio's only layout primitive (`PATCH /api/dashboards/:id`) requires the caller to
supply fully-resolved `{x,y,w,h}`. The model is good at judging panel importance and
size; it is bad at emitting 30 non-overlapping rectangles. Helio should do the
geometry once, server-side, so agents (and `helio-news`'s `run._pack`) can stop
re-deriving it.

## What Changes

- Add `POST /api/dashboards/:id/auto-layout`: accepts `[{panelId, w, h}]` (+ optional
  `cols`, default 12), packs them left-to-right with shelf-wrap (order preserved =
  visual order), applies per-kind clamping (min width, min/max height) so an
  out-of-bounds size can't render broken, widens a nearly-full shelf to close a
  ragged right edge, and persists the result via the existing layout write path
  (`DashboardService`/`DashboardRepository`), returning the updated dashboard.
  Panels omitted from the input keep their current saved position; a `panelId` not
  on the dashboard is rejected with 400.
- Port `helio-news`'s `_pack` / `_fill_shelf` / `_clamp` / `_BOUNDS` (`news/run.py`)
  to a pure Scala packing module — testable in isolation from HTTP/DB.
- Add MCP tool `auto_layout_dashboard` (`helio-mcp/src/tools/write.ts` +
  `helio-mcp/src/helioApi.ts`) taking panel ids + sizes, calling the new endpoint.
- Update `schemas/` (JSON Schema) and `openspec/` (OpenAPI) for the new
  request/response shape.
- One placement is computed and applied identically to all four responsive
  breakpoints (lg/md/sm/xs) — this matches the codebase's existing convention for
  every non-interactive layout writer (`DashboardContentsService.remapLayout`,
  the MCP `updateDashboardLayout`), not a new decision. The interactive
  drag/resize grid (`DesktopPanelGrid`) still resolves genuinely independent
  per-breakpoint layouts via `resolveDashboardLayout`'s projection/fallback path —
  auto-layout is a bulk, non-interactive writer and follows the bulk-writer
  convention, not the interactive one.

## Capabilities

### New Capabilities

- `dashboard-auto-layout`: server-side endpoint that packs `{panelId,w,h}` sizes
  into non-overlapping `{x,y,w,h}` positions on a 12-column (configurable) grid,
  with shelf-fill widening and per-kind clamping.

### Modified Capabilities

- `mcp-panel-composition-tools`: adds the `auto_layout_dashboard` tool.

## Impact

- Backend: new `AutoLayoutService` + pack algorithm module, new route file, wired
  into `ApiRoutes.scala`; reuses `DashboardRepository`/`PanelRepository`/
  `DashboardLayoutItemPayload`.
- `helio-mcp`: new tool + `helioApi.ts` method.
- `schemas/`, `openspec/`: additive request/response contract.
- No changes to `update_dashboard_layout`/`PATCH /api/dashboards/:id` (unchanged
  primitive) or to the frontend `PanelGrid`/`resolveDashboardLayout` interactive
  path.

## Non-goals

- Deciding panel sizes (stays the agent/model's judgement).
- Differing per-breakpoint layouts (matches current bulk-writer behavior).
- Compaction/reflow of an already-positioned dashboard.
- HEL-368 (panel id key reconciliation), HEL-369 (external-run hooks), HEL-624
  (pie/scatter aggregation) — noted as related but out of scope.
