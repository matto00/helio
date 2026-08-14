## ADDED Requirements

### Requirement: update_panel MCP tool
The MCP server SHALL expose an `update_panel` tool that accepts a `panelId` and optional
`title`/`type`/`config`/`appearance`, PATCHes `PATCH /api/panels/:id` with only the provided
fields, and returns the updated panel. `config`, when provided, SHALL be decoded server-side
against the panel's EXISTING stored `type` as a genuine per-field partial merge — an omitted
`config` field keeps its stored value, an explicit `null` clears it — the SAME convention as
`appearance`; the tool's description SHALL state this explicitly and SHALL NOT claim or imply a
wholesale replace. `type`, when provided, SHALL only ever match the panel's stored kind (a no-op)
or be rejected by the backend (a panel's kind is immutable); the tool SHALL NOT silently drop or
ignore a rejected value.

#### Scenario: Agent renames a panel without touching its config
- **WHEN** an agent calls `update_panel` with only `panelId` and a new `title`
- **THEN** the tool PATCHes only `title`, and the panel's existing `config`/`appearance` are
  unchanged

#### Scenario: Agent edits a metric panel's unit in place
- **WHEN** an agent calls `update_panel` with `panelId` and `config: { unit: "USD" }` for an
  existing metric panel
- **THEN** the panel's `unit` becomes `"USD"`, its `dataTypeId`/`fieldMapping`/`label` are
  unchanged, and its id and dashboard layout position are preserved

#### Scenario: Agent edits a chart panel's annotation in place
- **WHEN** an agent calls `update_panel` with `panelId` and `config: { annotation: "Q3 actuals" }`
  for an existing chart panel
- **THEN** the panel's `annotation` becomes `"Q3 actuals"` and its other config fields are
  unchanged

#### Scenario: Agent edits a markdown panel's content in place
- **WHEN** an agent calls `update_panel` with `panelId` and `config: { content: "# Updated" }` for
  an existing markdown panel
- **THEN** the panel's `content` becomes `"# Updated"`, its id and layout position are preserved,
  and no delete-and-recreate occurs

#### Scenario: Mismatched type is rejected, not silently applied
- **WHEN** an agent calls `update_panel` with a `type` that differs from the panel's stored kind
- **THEN** the tool surfaces the backend's 400 (panel type is immutable) verbatim, and the panel is
  unchanged
