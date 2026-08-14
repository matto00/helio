- `helio-mcp/src/types.ts` — added `UpdatePanelRequest` client-side interface (mirrors the
  backend's `UpdatePanelRequest`: optional `title`/`type`/`config`/`appearance`), documenting the
  `config` per-field partial-merge convention vs. `UpdateDataTypeRequest`'s wholesale-replace.
- `helio-mcp/src/tools/updateSchemas.ts` — added `buildUpdatePanelBody`, the omit-vs-absent PATCH
  body builder for `update_panel`, alongside the existing `buildUpdateDataTypeBody`/
  `buildUpdatePipelineStepBody` builders; updated the module header comment to name it.
- `helio-mcp/src/helioApi.ts` — added `HelioApi.updatePanel(panelId, patch)`, a thin
  `PATCH /api/panels/:id` pass-through, registered directly beside `updatePanelAppearance`.
- `helio-mcp/src/tools/write.ts` — registered the new `update_panel` MCP tool immediately after
  `update_panel_appearance` (design.md D1), with a description enumerating all nine patchable
  panel-kind `config` field lists and every merge/clear exception (chart `annotation`/
  `chartOptions`, text/markdown `content`, image `caption`/`imageUrl`/`imageFit`, collection
  `baseType`/`layout`/`itemOptions`, timeline `timelineOptions.sort`, divider `orientation`), the
  `type` immutability behavior, and the `bind_panel`-preferred cross-reference for binding fields
  (design.md D6). `type`'s Zod enum includes `"divider"` (unlike `create_panel`'s, which omits it)
  since this tool validates against an *existing* panel's stored kind, not a creatable one.
- `helio-mcp/src/tools/updateSchemas.test.ts` — added a `buildUpdatePanelBody` describe block
  (empty patch, each field in isolation, all-fields-together, and an omitted-key assertion),
  mirroring the existing `buildUpdateDataTypeBody`/`buildUpdatePipelineStepBody` coverage style.
- `helio-mcp/README.md` — added the `update_panel` row to the write/composition tool table,
  immediately after `update_panel_appearance`, noting the `config` partial-merge distinction from
  `update_data_type`.
- `helio-mcp/dist/` — rebuilt (`npm run build`, `tsc` exit 0) to verify the build succeeds; **not
  committed** — it is `.gitignore`d and was never tracked before this change (see final report for
  the flagged tasks.md 3.2 discrepancy).

No backend or frontend changes. `PATCH /api/panels/:id` is unmodified — this is a thin MCP-layer
pass-through only.
