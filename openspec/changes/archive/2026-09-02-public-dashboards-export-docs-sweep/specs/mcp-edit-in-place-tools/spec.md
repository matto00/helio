## REMOVED Requirements

### Requirement: update_data_type MCP tool
**Reason**: The DataType model was retired outright by HEL-904; `PATCH /api/types/:id` no longer
exists, and the MCP server no longer registers an `update_data_type` tool
(`helio-mcp/src/tools/updateSchemas.ts` documents this retirement directly in its own header
comment).
**Migration**: None — the semantic layer `update_data_type` edited is superseded by Outputs.
Rename/field edits for a pipeline-produced value are made by editing the pipeline (which
recomputes its Outputs), or via `update_output` for the Output's own display config.

### Requirement: update_panel MCP tool
**Reason**: The prior contract let `config` edit metric/chart-panel-level fields (`unit`,
`annotation`) directly, because those fields lived on the `Panel`'s own config. HEL-904 moved them
onto the Output (`unit`/`chartOptions`/etc. now live in `outputs.config`), so `update_panel`'s
`config` is narrowed to placement-only fields (currently just `outputId` for an `output`-kind
panel) — editing an Output's own display config is `update_output`'s job now.
**Migration**: Use `update_output` to edit a placed Output's `unit`/`chartOptions`/other display
config; use `update_panel` only for placement-level fields (`title`, `outputId` reassignment,
`content` for markdown, `appearance`).

## ADDED Requirements

### Requirement: update_panel MCP tool (placement fields only)
The MCP server SHALL expose an `update_panel` tool that accepts a `panelId` and optional
`title`/`type`/`config`/`appearance`, PATCHes `PATCH /api/panels/:id` with only the provided
fields, and returns the updated panel — a **placement-fields-only** tool (HEL-904): `config` is
decoded server-side against the panel's stored `type`, and for an `output`-kind panel the only
`config` field is `outputId` itself (reassigning which Output the placement points at). Editing an
Output's own display config (`fieldMapping`, `chartOptions`, `unit`, `columnWidths`, etc.) is
`update_output`'s job, not `update_panel`'s. `type`, when provided, SHALL only ever match the
panel's stored kind (a no-op) or be rejected by the backend (a panel's kind is immutable); the
tool SHALL NOT silently drop or ignore a rejected value.

#### Scenario: Agent renames a panel without touching its config
- **WHEN** an agent calls `update_panel` with only `panelId` and a new `title`
- **THEN** the tool PATCHes only `title`, and the panel's existing `config`/`appearance` are
  unchanged

#### Scenario: Agent reassigns an output-kind panel to a different Output
- **WHEN** an agent calls `update_panel` with `panelId` and `config: { outputId: "<other-output>" }`
  for an existing `output`-kind panel
- **THEN** the panel's `outputId` becomes the new value, and its id and dashboard layout position
  are preserved (no delete-and-recreate)

#### Scenario: Agent edits a markdown panel's content in place
- **WHEN** an agent calls `update_panel` with `panelId` and `config: { content: "# Updated" }` for
  an existing markdown panel
- **THEN** the panel's `content` becomes `"# Updated"`, its id and layout position are preserved,
  and no delete-and-recreate occurs

#### Scenario: Mismatched type is rejected, not silently applied
- **WHEN** an agent calls `update_panel` with a `type` that differs from the panel's stored kind
- **THEN** the tool surfaces the backend's 400 (panel type is immutable) verbatim, and the panel is
  unchanged
