# mcp-edit-in-place-tools Specification

## Purpose
Let an agent edit an existing data source, DataType, pipeline, or pipeline step in place via MCP,
instead of a lossy delete-and-recreate that breaks bindings, run history, and ids.

## Requirements

### Requirement: update_data_source MCP tool
The MCP server SHALL expose an `update_data_source` tool that accepts a `dataSourceId` and a
required `name`, PATCHes `PATCH /api/data-sources/:id`, and returns the updated data source. The
backend's update surface for a data source is rename-only; the tool SHALL NOT accept any other
field.

#### Scenario: Agent renames a data source
- **WHEN** an agent calls `update_data_source` with `dataSourceId` and a new `name`
- **THEN** the tool PATCHes the backend and returns the updated data source with the new name

### Requirement: update_pipeline MCP tool
The MCP server SHALL expose an `update_pipeline` tool that accepts a `pipelineId` and a required
`name`, PATCHes `PATCH /api/pipelines/:id`, and returns the updated pipeline summary. The backend's
update surface for a pipeline is rename-only; the tool SHALL NOT accept any other field.

#### Scenario: Agent renames a pipeline
- **WHEN** an agent calls `update_pipeline` with `pipelineId` and a new `name`
- **THEN** the tool PATCHes the backend and returns the updated pipeline summary with the new name

### Requirement: update_pipeline_step MCP tool
The MCP server SHALL expose an `update_pipeline_step` tool that accepts a `stepId` and optional
`config`/`position`, PATCHes `PATCH /api/pipeline-steps/:id` with only the provided fields, and
returns the updated step. The tool SHALL NOT accept a `type` field — a pipeline step's type is
immutable at the backend, so no MCP-layer use of it can succeed.

#### Scenario: Agent edits a step's config in place
- **WHEN** an agent calls `update_pipeline_step` with `stepId` and a new `config`
- **THEN** the tool PATCHes the backend, the step's ordering and id are unchanged, and
  `analyze_pipeline` reflects the new config on that step

#### Scenario: Agent reorders a step
- **WHEN** an agent calls `update_pipeline_step` with `stepId` and a new `position`
- **THEN** the step moves to that position without needing to be deleted and re-added

### Requirement: update_dashboard MCP tool
The MCP server SHALL expose an `update_dashboard` tool that accepts a `dashboardId` and a required non-empty `name`,
PATCHes `PATCH /api/dashboards/:id` with only that `name`, and returns the updated dashboard. Renaming SHALL preserve
the dashboard's id, so existing links to it keep resolving; the tool exists specifically to replace the lossy
delete-and-recreate that a name correction otherwise requires. The tool SHALL NOT accept `layout`, which already has its own
dedicated tool, nor `appearance`, which is out of scope for this capability. The tool's description SHALL NOT claim
that either field is covered elsewhere on the MCP surface unless it actually is.

#### Scenario: Agent corrects a dashboard name
- **WHEN** an agent calls `update_dashboard` with a `dashboardId` and a new `name`
- **THEN** the tool PATCHes the backend and returns the dashboard with the new name

#### Scenario: Rename preserves the dashboard id
- **WHEN** an agent renames a dashboard via `update_dashboard`
- **THEN** the returned dashboard's id is the same id it had before the rename, and any link built from that id
  still resolves

#### Scenario: A name containing an ampersand is not entity-encoded
- **WHEN** an agent calls `update_dashboard` with a name containing `&`
- **THEN** the stored name contains a literal `&` and never acquires an HTML entity such as `&amp;` anywhere on the
  MCP request or response path

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
