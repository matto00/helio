# Files modified — HEL-367 auto-pack-layout-helper

- `backend/src/main/scala/com/helio/services/layout/PanelPacker.scala` — new pure Scala port of
  helio-news's `_pack`/`_fill_shelf`/`_clamp`/`_BOUNDS` (design.md D3/D4); zero HTTP/DB dependency.
- `backend/src/test/scala/com/helio/services/layout/PanelPackerSpec.scala` — unit coverage: empty/single
  panel, wrap, shelf-fill widening (nearly-full + sparse), per-kind clamp correction (under/oversized
  width and height, default-bounds kind), determinism, and a hand-rolled overlap-freedom property test
  over 200 random `(kind, w, h)` seeds (design.md D5's no-ScalaCheck fallback).
- `backend/src/main/scala/com/helio/services/AutoLayoutService.scala` — new service: ACL (mirrors
  `DashboardContentsService.authorizeEditor`), resolves panel kinds + existing `layout.lg`, validates
  every request `panelId` belongs to the dashboard (400 on the first unknown, no persistence), packs via
  `PanelPacker`, persists `DashboardLayout(lg=md=sm=xs=items)` via `dashboardRepo.update` (design.md
  D1/D6).
- `backend/src/main/scala/com/helio/api/routes/AutoLayoutRoutes.scala` — new thin-shell route,
  `POST /dashboards/:id/auto-layout`, mirrors `DashboardContentsRoutes`.
- `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` — adds
  `AutoLayoutItemPayload`/`AutoLayoutRequest` case classes + Spray JSON formatters.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports the two new protocol types (existing
  `com.helio.api._` re-export convention).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `AutoLayoutService` + `AutoLayoutRoutes`
  into the authenticated route tree, ahead of `DashboardRoutes`.
- `backend/src/test/scala/com/helio/api/AutoLayoutRouteSpec.scala` — route-level coverage: pack +
  persist identically to lg/md/sm/xs, 400 on unknown panelId with no persistence, omitted-panel position
  retention (design.md D6), empty-items pass-through, and the owner/editor/viewer/no-access ACL matrix.
- `helio-mcp/src/helioApi.ts` — adds `autoLayoutDashboard(dashboardId, items, cols?)` calling the new
  endpoint.
- `helio-mcp/src/tools/write.ts` — adds the `auto_layout_dashboard` MCP tool (zod input schema, guarded
  handler surfacing backend 400s verbatim).
- `schemas/auto-layout-item.schema.json` — new JSON Schema for `AutoLayoutItemPayload`.
- `schemas/auto-layout-request.schema.json` — new JSON Schema for `AutoLayoutRequest`, `$ref`s the item
  schema.
- `openspec/changes/auto-pack-layout-helper/tasks.md` — all 13 tasks checked off as completed.
