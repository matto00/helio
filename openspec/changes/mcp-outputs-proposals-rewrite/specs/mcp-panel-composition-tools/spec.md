## REMOVED Requirements

### Requirement: create_panel MCP tool
**Reason**: Superseded by `place_outputs` (mcp-output-tools) for Output-backed panels and
`create_content_panel` for non-Output panels — a panel is now created by placing an Output, not by
binding to a DataType.
**Migration**: Callers creating an Output-backed panel use `place_outputs`; callers creating a
markdown/divider/image panel use `create_content_panel`.

### Requirement: create_panels MCP tool
**Reason**: See `create_panel` above; batch creation is now `place_outputs`' array argument.
**Migration**: Pass multiple `{outputId, title?, w?, h?}` entries to one `place_outputs` call.

### Requirement: bind_panel MCP tool
**Reason**: Panel-to-DataType binding no longer exists; a panel is created already bound to its
Output via `place_outputs`.
**Migration**: None — `place_outputs` replaces the create+bind two-step with one call.

### Requirement: create_bound_panel MCP tool
**Reason**: See `bind_panel` above.
**Migration**: Use `place_outputs`.

### Requirement: get_panel_capabilities MCP tool
**Reason**: Superseded by `get_output_capabilities(pipelineId, stepId?)` (mcp-output-tools), which
queries capabilities at a specific pipeline node rather than via a panel's binding.
**Migration**: Callers pass the pipeline id and target step id directly.

## MODIFIED Requirements

### Requirement: update_panel MCP tool
The MCP server SHALL expose `update_panel` accepting only placement fields (`title`, `w`, `h`,
position) — DataType/binding fields SHALL NOT be accepted, since a panel's Output binding is fixed
at placement time and is not mutable via `update_panel`.

#### Scenario: Agent resizes a placed panel
- **WHEN** an agent calls `update_panel` with a valid `panelId` and new `w`/`h`
- **THEN** the tool updates the placement and returns the updated panel

#### Scenario: Attempting to rebind a panel's Output is rejected
- **WHEN** an agent calls `update_panel` with a field attempting to change the panel's bound
  Output
- **THEN** the tool rejects the call before issuing any HTTP request, since `update_panel`'s
  schema does not accept a binding field
