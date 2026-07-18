# Files modified — HEL-315 (mcp-v15-panel-parity)

## Source changes

- `schemas/create-panel-request.schema.json` — add `collection` to the `type`
  enum + an `allOf` branch mapping `type: collection` → `panel.schema.json#/$defs/CollectionConfig`.
  Absorbs HEL-310. `divider` intentionally left in the schema enum (the backend
  still accepts it on other paths); only the MCP create tool drops it — an
  intentional asymmetry (design D5).
- `helio-mcp/src/helioApi.ts` —
  - `createPanel` now accepts an optional `appearance` passthrough. When it
    carries a `chart` object, the caller's partial chart fields (notably
    `chartType`) are overlaid onto a COMPLETE default `ChartAppearance`
    (`seriesColors`/`legend`/`tooltip`/`axisLabels` + `chartType`) so the
    backend's non-optional `jsonFormat5(ChartAppearance)` deserialization
    succeeds — a bare `{ chart: { chartType } }` would 400 before the service
    runs (design D2, proven by the live bar-chart smoke test).
  - new `uploadImage({ content, filename, mime?, encoding? })` — single `file`
    multipart part to `POST /api/uploads/image` (reuses `postMultipart`),
    `content` base64 by default; returns `{ id, url, markdownRef }` where
    `markdownRef = helio://uploads/image/<id>` (design D4).
  - `bindPanel` `fieldMapping` is now optional (table binds with no mapping);
    doc updated for text/markdown/collection.
- `helio-mcp/src/tools/write.ts` —
  - `create_panel`: type enum → `metric/chart/table/text/markdown/image/collection`
    (add `collection`, drop `divider`); new optional `appearance` input;
    description rewritten to document each type's config (chart `chartOptions`,
    table `density`/`columnOrder`, collection `baseType`/`layout`,
    text/markdown `content`, image `imageUrl`/`imageFit`) and the
    `helio://uploads/image/<id>` markdown ref scheme.
  - `bind_panel`: `panelType` enum extended to `text`/`markdown`/`collection`;
    `fieldMapping` optional; description documents verified per-type field keys
    (metric/collection `value/label?/unit?`, chart `xAxis/yAxis/series?`,
    text/markdown `content`, table = no mapping — `columns` is vestigial,
    superseded by `config.columnOrder`) and the collection baseType/layout merge-patch note.
  - new `upload_image` tool registered (content + filename + optional mime/encoding
    → id/url/markdownRef).

Note: `helio-mcp/src/tools/proposal.ts` and `src/types.ts` still list `divider`
and omit `collection` for the `propose_dashboard`/`apply_proposal` flow — out of
scope here (design Impact lists only write.ts/helioApi.ts/httpClient.ts/schemas).
Spinoff candidate: extend the proposal tool to the v1.5 type set.

## Ground-truth re-verification (tasks group 1)

- Bind keys: `MarkdownEditor.tsx`/`TextContentEditor.tsx` both write
  `fieldMapping.content`; backend `MarkdownPanelConfig`/`TextPanelConfig` read
  `fieldMapping` object → text/markdown bind key is `content`. ✓
- Collection: `panelSlots.ts` collection derives item slots from
  `PANEL_SLOTS[baseType]` (metric → `value/label/unit`); `CollectionPanel.applyPatch`
  preserves `baseType`/`layout` when absent from the patch (merge). ✓
- Chart/table config shapes copied verbatim from `panel.schema.json` `$defs`
  (`ChartOptions`, `TableConfig` density/columnOrder, `CollectionConfig`). ✓
- Upload: `UploadRoutes.scala` single `file` part → `201 { id, url }`,
  `url = /api/uploads/image/<id>`; `markdownUrls.ts` resolves
  `helio://uploads/image/<id>`. ✓
- `ChartAppearance` (`model.scala`) is `jsonFormat5` with only `chartType`
  optional → complete-appearance requirement confirmed (design D2). ✓

## Live smoke-test evidence

Backend: worktree on `http://localhost:8395` (healthy). PAT minted via dev login
`matt@helio.dev` → `POST /api/tokens` (CSRF header `X-Helio-Requested-With: 1`).
Driven through the BUILT server (`dist/index.js`) over the real MCP stdio
protocol (SDK `Client` + `StdioClientTransport`).

- Dashboard: `fff6ab10-5263-4519-9da3-4d0e13cd7687`
- `upload_image` present in tools/list = true.
- **Collection** panel `07124aad-8405-4180-be67-f0bbc5080260`: created with
  `{ baseType: metric, layout: grid }`, then `bind_panel` (panelType collection,
  fieldMapping `{ value: amount, label: name }`) to a real pipeline-output
  DataType (`f894ce51-…`, 3 rows). Bound config:
  `{"baseType":"metric","dataTypeId":"f894ce51-…","fieldMapping":{"label":"name","value":"amount"},"layout":"grid"}`
  → baseType/layout PRESERVED across the bind (merge-patch, D3 proven).
- **upload_image** → `{ id: 931024e1-…, url: /api/uploads/image/931024e1-…, markdownRef: helio://uploads/image/931024e1-… }`.
  Served image: `GET /api/uploads/image/931024e1-…` → HTTP 200, `image/png`, valid PNG.
- **Markdown** panel `86b4f920-…`: `config.content` =
  `"# Story\n\n![cover](helio://uploads/image/931024e1-…)"` — persisted.
- **Bar chart** panel `2e3418c6-…`: created with `appearance.chart.chartType=bar`;
  persisted `appearance.chart` = complete ChartAppearance (all required fields +
  `chartType:"bar"`); `config.chartOptions.bar` =
  `{ orientation: horizontal, stacking: stacked, barGapPct: 20 }` — persisted.
- Export (`get_dashboard`) confirms all 3 panels persist with the above config.
- Invalid chartType (`pyramid`) → backend 400 verbatim:
  `{"message":"Invalid chartType value: 'pyramid'. Valid values: bar, line, pie, scatter"}`.

## Gate results

- `helio-mcp` `npm run build` (tsc) — exit 0, no type errors.
- `npm run check:schemas` — exit 0 ("schemas in sync with JsonProtocols").
- `openspec validate mcp-v15-panel-parity --strict` — valid, exit 0.
- No `lint` script exists in `helio-mcp/` (no eslint config); tsc strict build is
  the type gate. No unit-test harness in `helio-mcp/` — live smoke test is the
  behavioral evidence (task 6.1).
- `npm run check:openspec` reports only "complete (22/22) but not archived" —
  the expected pre-archive state (archiving is a later workflow step).
