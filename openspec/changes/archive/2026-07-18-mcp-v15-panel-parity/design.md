## Context

`helio-mcp/src/tools/write.ts` exposes `create_panel` (type enum
`metric/chart/table/text/markdown/image/divider`) and `bind_panel` (`panelType` limited to
`metric/chart/table`, `fieldMapping` free-form). The v1.5 Panel System v2 backend (already on the
worktree's base, HEL-309 @ #244) supports more, verified against ground truth:

- `schemas/panel.schema.json` — response contract; `type` enum already includes `collection`, and
  `$defs` carry the exact config shapes (ChartOptions, TableConfig density/columnOrder,
  CollectionConfig baseType/layout/itemOptions).
- `frontend/src/features/panels/state/panelSlots.ts` — `PANEL_SLOTS` gives the fieldMapping keys:
  metric `value/label/unit`, chart `xAxis/yAxis/series`, text `content`, table/markdown/collection
  empty (collection derives item slots from `PANEL_SLOTS[baseType]`).
- `frontend/.../editors/TextContentEditor.tsx` + `MarkdownEditor.tsx` — both bind via
  `fieldMapping.content` (Source mode) vs literal `config.content` (Static mode).
- `backend/.../panels/CollectionPanel.scala` + `PanelConfigCodec.scala` +
  `PanelPatchApplier.scala` — PATCH `config` is a **merge** (`*Config.Patch.decode` preserves
  absent fields), so create-time `baseType`/`layout` survive a later `bind_panel`.
- `backend/.../routes/UploadRoutes.scala` + `ImageUploadProtocol.scala` — `POST /api/uploads/image`
  takes one multipart `file` part, returns `201 { id, url }` where `url = /api/uploads/image/<id>`.

Constraint: helio-mcp is a distinct TS build with no concertino worktree/dev-server tooling. It
authenticates via `HELIO_PAT` (a `helio_pat_…` token) against `HELIO_API_BASE_URL`. Verification
must build `dist` (tsc) and run a live smoke test against the worktree's backend port.

## Goals / Non-Goals

**Goals:**
- `create_panel` type enum = `metric/chart/table/text/markdown/image/collection` (add collection,
  drop divider); description documents every type's config + the markdown image ref scheme.
- `create_panel` accepts optional `appearance` so chart `chartType` is settable at creation; docs
  cover `chartOptions`, table `density`/`columnOrder`, collection `baseType`/`layout`.
- `bind_panel` `panelType` = `metric/chart/table/text/markdown/collection` with per-type field
  mappings documented against verified wire keys.
- New `upload_image` tool returns id + served url + `helio://uploads/image/<id>` ref.
- `schemas/create-panel-request.schema.json` type enum adds `collection` (absorbs HEL-310).

**Non-Goals:** no backend/frontend/DB change; no new collection base types; no `divider` creation.

## Decisions

**D1 — Wire keys are copied from ground truth, never invented.** The executor MUST re-confirm each
documented key against `panel.schema.json` / `panelSlots.ts` / the `*Panel.scala` codecs at
implementation time. Confirmed now: text/markdown bind → `fieldMapping: { content: "<col>" }`;
collection bind → metric slots `{ value, label?, unit? }` (its `baseType` default); chart
`config.chartOptions` = `{ line:{smooth,showPoints,areaFill}, bar:{orientation,stacking,barGapPct},
pie:{donutHolePct,showPercentLabels}, scatter:{sizeField,colorField} }`; table `config` =
`{ density: condensed|normal|spacious, columnOrder: string[] }`.

**D2 — Chart type at creation via a COMPLETE `appearance.chart`, not a bare `{ chartType }`.**
HEL-305's create channel is `appearance.chart.chartType`. Add an optional `appearance` passthrough
param to `create_panel` (and `HelioApi.createPanel`) rather than a bespoke `chartType` field — it
mirrors the create-panel-request schema's `appearance` property and reuses the `update_panel_appearance`
shape. **Critical constraint (verified):** the backend `ChartAppearance`
(`backend/.../domain/model.scala`) is decoded by spray-json `jsonFormat5` where `seriesColors`,
`legend`, `tooltip`, and `axisLabels` are **non-Optional** — only `chartType` is `Option`. A payload of
`{ chart: { chartType: "bar" } }` throws a `DeserializationException` during
`entity(as[CreatePanelRequest])` (no ExceptionHandler exists → generic 400) BEFORE the service runs.
Therefore the MCP wrapper MUST send a **complete** `ChartAppearance`: merge the caller's `chartType`
(and any partial chart fields) into `ChartAppearance.Default`'s `seriesColors`/`legend`/`tooltip`/
`axisLabels` before POSTing. Concretely, `HelioApi.createPanel` builds the full default chart
appearance and overlays the supplied `chartType`; the tool should NOT forward a partial object raw.
Alternative (post-create `update_panel_appearance`) already works but costs an extra call and doesn't
match the DoD "creation can specify chart type"; keep the completed passthrough as primary, mention the
fallback. The live smoke test (bar chart) is the proof this is built correctly, not guessed.

**D3 — Collection is create-then-bind, relying on merge-patch.** `create_panel` sets
`config: { baseType, layout }` (strict-validated at create; invalid layout → 400); `bind_panel`
then PATCHes `config: { dataTypeId, fieldMapping }`, and `CollectionPanel.applyPatch` preserves
`baseType`/`layout`. `bind_panel` keeps its current body shape — no new required params — with
`panelType: "collection"` and metric-slot `fieldMapping`. Document that layout/baseType belong on
`create_panel`.

**D4 — `upload_image` mirrors `create_csv_data_source`.** Reuse `HelioHttpClient.postMultipart`;
`form.set("file", new Blob([bytes]), filename)`. Input: base64 (or utf-8) content + filename +
optional mime. Return `{ id, url, markdownRef: "helio://uploads/image/<id>" }`. Document that
markdown panels reference the image via the `helio://` ref inside `config.content`, image panels via
`config.imageUrl`.

**D5 — Schema enum fix is in-scope (absorbs HEL-310).** Add `collection` to
`create-panel-request.schema.json`'s `type` enum and a matching `allOf` branch pointing at
`panel.schema.json#/$defs/CollectionConfig`, keeping schema and MCP in agreement. Leave `divider` in
the schema enum (the backend still accepts it on other paths; only MCP creation drops it) — note
this asymmetry so it is intentional, not an oversight.

## Risks / Trade-offs

- [Live smoke test needs a PAT] → The executor mints one via the running backend
  (`POST /api/tokens`, dev login `matt@helio.dev`), points `HELIO_API_BASE_URL` at the worktree
  backend port, builds `dist`, and drives the three panel kinds. If PAT/auth blocks the test →
  BLOCKER escalation (per orchestrator directive), not a silent skip.
- [Removing `divider` from create_panel is source-breaking for callers] → Intended (HEL-249);
  called out in proposal as BREAKING; no known MCP caller passes `divider`.
- [Documenting a wrong wire key silently mis-binds] → D1 mandates re-verification + the live smoke
  test renders each kind, so a wrong key surfaces as an unrendered panel, not a false pass.
- [`appearance` passthrough could let callers set invalid chartType] → the backend validates
  `chartType` against its allowed set on create (per create-panel-request schema) and returns 400
  verbatim via `guarded`; the MCP does not re-validate.

## Planner Notes (self-approved)

- Single capability + single PR (the ticket's preferred seam) — the `upload_image` tool ships with
  the panel-parity docs since together they enable the `helio-news` story-photo flow.
- Adding an `appearance` param to `create_panel` is a small, additive signature change (self-
  approved — not a new external dependency or architectural shift).
- Schema enum fix absorbed from HEL-310 (self-approved; note on the ticket so HEL-310 can be closed).
