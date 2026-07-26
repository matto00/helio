## 1. Backend: pack algorithm module

- [x] 1.1 Create a pure Scala module (e.g. `backend/src/main/scala/com/helio/services/layout/PanelPacker.scala`)
      porting `_pack`/`_fill_shelf`/`_clamp`/`_BOUNDS`/`_FALLBACK` from `~/Development/helio-news/news/run.py`:
      shelf-flow left-to-right wrap preserving input order, ragged-edge fill-shelf widening (fill threshold
      7/12), per-kind clamp table (design.md D4), default clamp `(minW=1, minH=2, maxH=24)` for kinds not in
      the table. No HTTP/DB imports in this file.
- [x] 1.2 Function signature takes ordered `(panelId: PanelId, kind: String, w: Int, h: Int)` and `cols: Int`,
      returns ordered `Vector[DashboardLayoutItem]` (or equivalent) with no pairwise overlaps by construction.

## 2. Backend: service + persistence

- [x] 2.1 Add `AutoLayoutService` (`backend/src/main/scala/com/helio/services/`) that: resolves ACL via
      `dashboardRepo.findById` mirroring `DashboardContentsService.authorizeEditor`'s owner/editor-grantee
      pattern; fetches the dashboard's panels (kind lookup) and existing `layout.lg` (for kept/omitted
      panels, design.md D6); validates every request `panelId` belongs to the dashboard, 400 on the first
      unknown id with no persistence (mirrors `DashboardContentsService.validatePanels`); calls the D1
      packer against `cols` (default 12); builds `DashboardLayout(lg=items, md=items, sm=items, xs=items)`
      where `items` = kept (omitted) positions + newly packed positions; persists via
      `dashboardRepo.update` (same path `DashboardService.applyUpdate` uses for `layoutOpt`).
- [x] 2.2 Define request/response case classes in `DashboardProtocol.scala` (e.g.
      `AutoLayoutRequest(items: Vector[AutoLayoutItemPayload], cols: Option[Int])`,
      `AutoLayoutItemPayload(panelId: String, w: Int, h: Int)`) + Spray JSON formatters — never inline
      fully-qualified names (CLAUDE.md).

## 3. Backend: route wiring

- [x] 3.1 Add `AutoLayoutRoutes.scala` under `backend/src/main/scala/com/helio/api/routes/`, mirroring
      `DashboardContentsRoutes`'s thin-shell shape: `POST /dashboards/:id/auto-layout`.
- [x] 3.2 Wire `AutoLayoutService` + `AutoLayoutRoutes` into `ApiRoutes.scala` (constructor wiring +
      route composition), following the exact pattern used for `dashboardContentsService`/
      `DashboardContentsRoutes`.

## 4. Backend: tests

- [x] 4.1 ScalaTest unit tests for the packer module: basic wrap (row overflow triggers new shelf),
      shelf-fill widening (ragged edge closed, sparse shelf untouched), per-kind clamp correction
      (undersized + oversized), single-panel, empty input.
- [x] 4.2 Overlap-freedom property test (ScalaCheck if already a build.sbt dependency, else a hand-rolled
      generator loop per design.md D5's fallback): many randomly generated `(kind, w, h)` lists, assert zero
      pairwise rectangle overlaps in every packed output.
- [x] 4.3 `AutoLayoutService`/route-level tests: 400 on unknown panelId (no persistence), omitted panels
      keep their saved position, successful request persists identically to lg/md/sm/xs, ACL (owner/editor
      proceed, viewer 403, no-access 404) mirroring `DashboardContentsService`'s existing ACL test pattern.

## 5. MCP surface

- [x] 5.1 Add `helioApi.ts#autoLayoutDashboard(dashboardId, items, cols?)` calling the new endpoint,
      mirroring `updateDashboardLayout`'s doc-comment style.
- [x] 5.2 Add `auto_layout_dashboard` tool in `helio-mcp/src/tools/write.ts` (`server.registerTool`,
      zod `inputSchema` for `dashboardId`/`items`/`cols`), description documenting that it replaces
      `_pack`/`_fill_shelf`/`_clamp` for agent callers, mirroring `create_panels`'s description style
      (backend 400s surfaced verbatim).

## 6. Contract docs

- [x] 6.1 Add the auto-layout request/response shape to `schemas/` (JSON Schema 2020-12).
- [x] 6.2 Add the `POST /api/dashboards/:id/auto-layout` path to `openspec/` (OpenAPI). This repo's
      `openspec/` is spec-driven (capability `spec.md` files, not a raw OpenAPI document) — the
      `dashboard-auto-layout` and `mcp-panel-composition-tools` capability specs already added under
      this change's `specs/` directory (read in step 1) ARE that documentation; they get merged into
      `openspec/specs/` at archive time per this repo's existing convention (see e.g.
      `openspec/specs/dashboard-contents-replace/spec.md` from HEL-363). No separate artifact needed.
