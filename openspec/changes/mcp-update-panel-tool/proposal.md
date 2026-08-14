## Why

`helio-mcp` only exposes `update_panel_appearance`, so an agent has no way to edit a panel's
`title` or `config` (metric `unit`, chart `annotation`, table `columnOrder`, markdown/text
`content`) in place — even though the backend's `PATCH /api/panels/:id` already supports all of
it. Every such edit today forces delete-and-recreate, churning panel ids and re-packing layout.
Panels are simply missing from HEL-328's edit-in-place parity table; this closes that gap.

## What Changes

- Add an `update_panel` MCP tool (`helio-mcp/src/tools/write.ts`) + `HelioApi.updatePanel` method
  (`helio-mcp/src/helioApi.ts`) as a thin pass-through to the existing, unmodified
  `PATCH /api/panels/:id`. No backend changes.
- Accept optional `title`, `type`, `config`, `appearance` — mirroring the backend's
  `UpdatePanelRequest`. A body-builder (`updateSchemas.ts`) includes only the arguments the caller
  actually supplied, mirroring `buildUpdateDataTypeBody`/`buildUpdatePipelineStepBody`.
- Document, verified against `PanelServiceHelpers`/each panel subtype's own `Patch.decode`
  (not assumed): `config` is a genuine per-field partial merge (an omitted field keeps its stored
  value, an explicit `null` clears it) — the SAME convention `appearance` already uses — decoded
  against the panel's EXISTING stored `type`. This differs from `update_data_type`, whose
  `fields`/`computedFields` replace wholesale; the tool description states the distinction
  explicitly, plus the two per-field exceptions (`content` clears to `""`, not removed, on
  explicit `null`; a chart `annotation` also clears on blank/whitespace, not only `null`).
  Document each patchable panel kind's config field names (mirrors `create_panel`'s per-type list).
- `type`, when supplied, is validated against the panel's stored kind: a mismatch is rejected by
  the backend (400, panel kind is immutable); a match is a harmless no-op. The tool documents this
  rather than silently dropping the field.
- Reuse the shared `guarded` wrapper so backend 400/403/404 surface verbatim.
- Update the README tool table; rebuild `dist/`.

## Capabilities

### Modified Capabilities

- `mcp-edit-in-place-tools`: add the `update_panel` tool as the fifth edit-in-place resource
  (alongside `update_data_source`/`update_data_type`/`update_pipeline`/`update_pipeline_step`
  from HEL-328), with its own merge-semantics requirement (config partial-merge vs.
  wholesale-replace, per-field clear exceptions).

## Impact

- `helio-mcp/src/tools/write.ts` — new `update_panel` tool registration.
- `helio-mcp/src/helioApi.ts` — new `updatePanel` method.
- `helio-mcp/src/tools/updateSchemas.ts` — new `buildUpdatePanelBody` builder.
- `helio-mcp/src/types.ts` — new `UpdatePanelRequest` client-side interface.
- `helio-mcp/src/tools/updateSchemas.test.ts` — new unit tests for the body builder.
- `helio-mcp/README.md` — tool table row.
- `helio-mcp/dist/` — rebuilt.
- No backend or frontend changes; `PATCH /api/panels/:id` is unmodified.
