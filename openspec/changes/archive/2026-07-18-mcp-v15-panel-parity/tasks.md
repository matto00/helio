## 1. Ground-truth re-verification (before writing any docs)

- [x] 1.1 Re-confirm the create_panel type set + config shapes against `schemas/panel.schema.json`
      `$defs` (Chart/Table/Collection configs) — do not rely on memory
- [x] 1.2 Re-confirm bind field-mapping keys: `frontend/.../state/panelSlots.ts` (`PANEL_SLOTS`) +
      `TextContentEditor.tsx`/`MarkdownEditor.tsx` (`fieldMapping.content`) + `CollectionPanel.scala`
- [x] 1.3 Confirm PATCH `/api/panels/:id` merges config (`PanelConfigCodec.applyConfigPatch` /
      `CollectionPanel.applyPatch`) so create-time `baseType`/`layout` survive a later bind
- [x] 1.4 Confirm the upload contract: `POST /api/uploads/image`, single `file` part, `201 {id,url}`
      (`UploadRoutes.scala` / `ImageUploadProtocol.scala`); confirm the `helio://uploads/image/<id>`
      markdown ref in the markdown renderer

## 2. Schema (create-panel-request)

- [x] 2.1 Add `collection` to the `type` enum in `schemas/create-panel-request.schema.json`
- [x] 2.2 Add an `allOf` branch mapping `type: collection` → `panel.schema.json#/$defs/CollectionConfig`
- [x] 2.3 Note in the change that this absorbs HEL-310; leave `divider` in the schema enum (backend
      still accepts it elsewhere) — intentional asymmetry vs the MCP create tool

## 3. helio-mcp — API client (helioApi.ts / httpClient.ts)

- [x] 3.1 Extend `HelioApi.createPanel` to accept an optional `appearance` passthrough; when a chart
      `chartType` is supplied, build and send a COMPLETE `ChartAppearance` (merge chartType into the
      default `seriesColors`/`legend`/`tooltip`/`axisLabels`) — a bare `{ chartType }` fails backend
      spray-json deserialization (`ChartAppearance` non-optional fields)
- [x] 3.2 Add `HelioApi.uploadImage({ content, filename, mime? })` using `postMultipart` with a single
      `file` part; return `{ id, url }` and derive `markdownRef: helio://uploads/image/<id>`
- [x] 3.3 Reuse existing `postMultipart` — no httpClient shape change unless a gap is found

## 4. helio-mcp — write/composition tools (write.ts)

- [x] 4.1 `create_panel`: type enum → `metric/chart/table/text/markdown/image/collection` (add
      `collection`, remove `divider`)
- [x] 4.2 `create_panel`: add optional `appearance` input (chart type set via a COMPLETE
      ChartAppearance per 3.1, not a bare `{ chartType }`); rewrite description to document each type's
      config, chart `chartOptions`, table `density`/`columnOrder`, collection `baseType`/`layout`, and
      the `helio://uploads/image/<id>` markdown ref; frame the divider drop as agent/UI parity, not an
      API-level rejection (the backend still accepts `type: divider`)
- [x] 4.3 `bind_panel`: extend `panelType` enum to add `text`/`markdown`/`collection`; rewrite
      description with verified per-type `fieldMapping` keys and the collection baseType/layout note
- [x] 4.4 `bind_panel`: fix the pre-existing stale `table → {columns}` doc — the `columns` slot is
      vestigial (never read; superseded by `config.columnOrder` per HEL-255); document table binding as
      fieldMapping-optional so no stale/false key remains (DoD "no stale type lists remain")
- [x] 4.5 Register the new `upload_image` tool (input: content + filename + optional mime; returns
      id/url/markdownRef); document the ref usage on markdown/image panels
- [x] 4.6 Grep write.ts (and read/context serializers) for any remaining stale `divider` / type-list
      mentions and fix

## 5. Build + live verification (REQUIRED — static type-check alone is insufficient)

- [x] 5.1 `npm run build` (tsc) in `helio-mcp/` producing `dist` with no type errors; `npm run lint`
- [x] 5.2 Start the worktree backend (BACKEND_PORT); mint a PAT (`POST /api/tokens`, dev login
      `matt@helio.dev`); export `HELIO_API_BASE_URL`=worktree backend + `HELIO_PAT`
- [x] 5.3 Live smoke test via the built MCP: create a collection panel, a markdown panel bound to an
      uploaded image (upload_image → ref in content), and a bar chart with chartOptions on a real
      dashboard; confirm each renders and persists (GET the dashboard/export)
- [x] 5.4 Escalate as BLOCKER if PAT/auth prevents the live smoke test — do not silently skip

## 6. Tests

- [x] 6.1 Add/extend helio-mcp unit tests covering the new create_panel enum, bind_panel panelType
      set, and upload_image request shape (if a test harness exists; else document the live-test
      evidence in the change)
- [x] 6.2 `openspec validate --change mcp-v15-panel-parity` passes; record smoke-test evidence
      (panel ids + render confirmation) in the change handoff
