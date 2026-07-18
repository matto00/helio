# HEL-315 — Update helio-mcp write/bind tools to v1.5 panel parity

URL: https://linear.app/helioapp/issue/HEL-315
Priority: High
Project: Helio v2.0 — Agentic Dashboard Creation

## Context

The helio-mcp write/composition tools (`helio-mcp/src/tools/write.ts`) predate the
v1.5 Panel System v2 work (PRs #230–244) and the bug-bash fleet (#236–243), so the
agent surface can't express the new panel capabilities. The MCP is the agent surface
(per the product vision, every endpoint is a future MCP tool), and `helio-news`
builds dashboards exclusively through it — this is the blocker for `helio-news` using
the new panel types.

This is a thin-wrapper update: no backend business logic changes, just bringing the
MCP tool schemas + descriptions (and one new upload tool) up to what the backend
already supports.

## Gaps found (audited against write.ts on main @ post-#244)

1. `create_panel` **type enum is stale.** Currently
   `metric/chart/table/text/markdown/image/divider`. Needs: **add** `collection`
   (HEL-247, the new homogeneous sub-type); **remove** `divider` (removed from
   creation in HEL-249 — creating one is invalid). Cross-check
   `schemas/create-panel-request.schema.json` (HEL-310 tracks the same
   `collection`-missing gap there; coordinate so schema and MCP agree).
2. `bind_panel` **only supports** `metric/chart/table`. v1.5 made **text** (HEL-244),
   **markdown** (HEL-245), and **collection** (HEL-247) panels DataType-bindable.
   Extend `panelType` and document each field mapping (confirm exact wire keys against
   `schemas/panel.schema.json` / backend during impl): text → single string field;
   markdown → source field; collection → base type + shared field mapping + layout
   (grid/list).
3. **Per-chart-type config not exposed** (HEL-248). Chart panels now persist
   `chartOptions` keyed by chart type (line: smooth/markers/area; bar:
   orientation/stacking/spacing; pie: donut/percent; scatter: size/color fields).
   Document the shape and the `appearance.chart.chartType` create-time channel
   (HEL-305) so an agent can create a bar/pie/scatter panel, not just line.
4. **Table density/column config not exposed** (HEL-255): `density`
   (condensed/normal/spacious) + `columnOrder`. Document on the table path.
5. **No image-upload tool.** HEL-246 added `POST /api/uploads/image`; HEL-245 added
   the `helio://uploads/image/<id>` markdown ref scheme. Add an `upload_image` MCP
   tool (mirror the multipart pattern already in `create_csv_data_source`) returning
   the id/ref, and document the ref scheme on `create_panel`'s markdown/image
   guidance. This is what lets `helio-news` attach real story photos.

## Definition of done

- [ ] `create_panel` accepts `collection`, rejects/omits `divider`; description
      documents each type's config + the markdown `helio://uploads/image/<id>` ref
      scheme
- [ ] `bind_panel` supports `text`/`markdown`/`collection` with correct,
      backend-verified field mappings documented per type
- [ ] Chart panel creation can specify chart type + per-type `chartOptions`; table
      path documents `density`/`columnOrder` — both verified end-to-end against a live
      backend
- [ ] New `upload_image` tool uploads an image and returns the id/ref usable in a
      markdown/image panel
- [ ] MCP builds (`dist`) and a live smoke test creates one of each new/updated panel
      kind (collection, bound markdown with an uploaded image, a bar chart) on a real
      dashboard
- [ ] Tool descriptions are accurate — no stale type lists remain

## Notes

- Natural split seam if too large for one PR: (a) create/bind panel-type parity +
  chart/table config docs, (b) the `upload_image` tool. Prefer one PR if it stays
  reviewable.
- After this ships, `helio-news`'s planner menu (`agents.story_offers()`) gets updated
  separately (not this ticket).

## Orchestrator directives (from delivery request)

- CRITICAL: helio-mcp has NO concertino worktree/dev-server tooling and is a distinct
  build. Verification MUST include: build the MCP (`npm run build` / tsc in helio-mcp
  → dist), then a LIVE end-to-end smoke test against a running Helio backend — create
  one of each new/updated panel kind (a collection, a bound markdown panel referencing
  an uploaded image, a bar chart with chartOptions) on a real dashboard and confirm
  they render. Static type-check alone is NOT sufficient evidence. The backend runs on
  BACKEND_PORT of this worktree; adapt the MCP to point at it. Escalate if the MCP's
  auth/PAT setup blocks a live smoke test.
- bind_panel wire keys: do NOT guess. Confirm exact field-mapping wire keys against
  `schemas/panel.schema.json` and the backend domain code before documenting them
  (config wire shapes were reworked across HEL-243/244/245/247/248/255).
- SCHEMA COORDINATION: HEL-310 (collection missing from
  create-panel-request.schema.json) overlaps gap #1 — fixing the schema enum here is
  in-scope if the MCP fix needs the schema to agree; note it so HEL-310 can be closed
  as absorbed.
- HYGIENE: screenshots/artifacts to scratchpad or gitignored tmp, NEVER repo root.
  Never bulk-delete by glob. `-n` bypass accepted ONLY when check:openspec-hygiene is
  the sole pre-commit failure pre-archive.
- This ticket touches helio-mcp (+ maybe schemas/), NOT frontend/backend app —
  mobile-viewport verification does NOT apply.
