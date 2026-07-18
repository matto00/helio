## Why

The helio-mcp write/composition tools (`helio-mcp/src/tools/write.ts`) predate the v1.5 Panel
System v2 work, so the MCP agent surface cannot express the new panel capabilities the backend
already supports. `helio-news` builds dashboards exclusively through MCP, so this is the blocker
for it (and any agent) using collection panels, DataType-bound text/markdown, per-chart-type
options, table density/column order, and uploaded images. This is a thin-wrapper update — no
backend business logic changes.

## What Changes

- `create_panel`: **add** `collection` to the type enum, **remove** `divider` (**BREAKING** for
  callers passing `divider`) — dropped for agent/UI parity, mirroring the human app's HEL-249
  removal of divider creation. (The backend wire contract still accepts `type: "divider"`; the MCP
  simply no longer offers it, matching the app.) Rewrite the description to document each type's
  `config` shape and the `helio://uploads/image/<id>` markdown ref scheme.
- `create_panel`: accept an optional `appearance` passthrough so a chart's `chart.chartType`
  (bar/pie/scatter/line) can be set at creation (HEL-305 create-time channel), and document the
  per-chart-type `config.chartOptions` (HEL-248) and table `config.density`/`columnOrder`
  (HEL-255) shapes.
- `bind_panel`: extend `panelType` to `text`/`markdown`/`collection`; document each field mapping
  (text/markdown → `fieldMapping.content`; collection → base-type slots, e.g. metric
  `value`/`label`/`unit`, with `baseType`/`layout` set at create time and preserved by the
  merge-patch).
- New `upload_image` tool: multipart `POST /api/uploads/image` (mirrors `create_csv_data_source`),
  returning the `id`, served `url`, and the `helio://uploads/image/<id>` markdown ref.
- Fix `schemas/create-panel-request.schema.json` type enum to add `collection` (absorbs HEL-310)
  so schema and MCP agree.

## Capabilities

### New Capabilities
- `mcp-panel-composition-tools`: the MCP create_panel/bind_panel/upload_image tools expressing v1.5
  panel parity — panel type set, per-type binding field mappings, chart/table config, image upload.

### Modified Capabilities
<!-- None: no existing capability's requirements change; mcp-data-source-tools is untouched. -->

## Impact

- Code: `helio-mcp/src/tools/write.ts`, `helio-mcp/src/helioApi.ts`, `helio-mcp/src/httpClient.ts`
  (reuse existing multipart), `schemas/create-panel-request.schema.json`.
- No backend, frontend, or DB changes. No new runtime dependencies.
- Verification requires a live Helio backend + a PAT (the MCP has no worktree/dev-server tooling).

## Non-goals

- No backend/frontend behavior changes; the backend already supports every shape documented here.
- `helio-news`'s planner menu update (`agents.story_offers()`) is a separate follow-up ticket.
- No new panel base types for collections (schema `baseType` stays `metric`); no `divider` create
  support (intentionally removed).
