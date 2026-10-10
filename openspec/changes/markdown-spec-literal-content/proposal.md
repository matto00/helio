## Why

DataTypes and the markdown "Source" (field-bound) content mode were retired (HEL-904, HEL-909, HEL-1139), but three
living specs still describe DataType/field-bound markdown content, and `crossFilterRows.ts` still treats a markdown
Output's stored `fieldMapping` as a cross-filter binding. Specs that describe behaviour the product no longer has
mislead every agent that plans against them.

## What Changes

- `markdown-panel`: REMOVE "Markdown panel renders CommonMark HTML in the dashboard grid" and ADD "Markdown panel
  renders its literal content as CommonMark HTML in the dashboard grid" (a MODIFIED delta cannot drop the stale
  "bound content" scenario) — content is the literal `config.content`; fill the `TBD` Purpose.
- `markdown-panel-content-source`: rewrite the Purpose line (it has no Source/Static requirement left).
- `mcp-panel-composition-tools`: rewrite the Purpose; MODIFY "upload_image MCP tool" and "Proposal panels accept a
  generic config passthrough" to drop the markdown-binding phrases.
- `crossFilterRows.ts`: drop the `markdown` case from `fieldMappingForKind`, so a markdown Output is never a
  cross-filter target (it renders no rows). A legacy stored `fieldMapping.content` no longer makes it one;
  `panel-cross-filtering` gains a requirement stating this.

## Capabilities

### New Capabilities

### Modified Capabilities
- `markdown-panel`: render requirement states literal-content-only rendering.
- `mcp-panel-composition-tools`: upload_image scenario and config-passthrough requirement drop markdown binding.
- `panel-cross-filtering`: ADD "A markdown Output panel is never a cross-filter target".

## Non-goals

- Other stale DataType / collection-panel wording in `mcp-panel-composition-tools` (collection scenario "bound to
  the DataType", "source-companion DataType id" scenario, the `propose_dashboard` type-set requirement) and in
  `markdown-panel` (top-level `content` vs `config.content`, "text ... SHALL have content: null"). Listed as
  follow-ups.
- Removing `fieldMapping` from `MarkdownOutputConfig` / `readMarkdownConfig` (still read by `configPatch.ts`).
- Any backend or data migration change.

## Impact

`openspec/specs/{markdown-panel,markdown-panel-content-source,mcp-panel-composition-tools}/spec.md`,
`frontend/src/utils/crossFilterRows.ts` and its test. No API, schema, or backend change.
