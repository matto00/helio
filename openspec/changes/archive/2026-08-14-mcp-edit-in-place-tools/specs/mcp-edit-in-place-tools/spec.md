## ADDED Requirements

### Requirement: update_data_source MCP tool
The MCP server SHALL expose an `update_data_source` tool that accepts a `dataSourceId` and a
required `name`, PATCHes `PATCH /api/data-sources/:id`, and returns the updated data source. The
backend's update surface for a data source is rename-only; the tool SHALL NOT accept any other
field.

#### Scenario: Agent renames a data source
- **WHEN** an agent calls `update_data_source` with `dataSourceId` and a new `name`
- **THEN** the tool PATCHes the backend and returns the updated data source with the new name

### Requirement: update_data_type MCP tool
The MCP server SHALL expose an `update_data_type` tool that accepts a `dataTypeId` and optional
`name`/`fields`/`computedFields`, PATCHes `PATCH /api/types/:id` with only the provided fields,
and returns the updated DataType. When `fields` or `computedFields` is provided, it SHALL replace
the existing array wholesale (not merge per item) — the tool's description SHALL state this
explicitly.

#### Scenario: Agent renames a DataType without touching its fields
- **WHEN** an agent calls `update_data_type` with only `dataTypeId` and `name`
- **THEN** the tool PATCHes only `name`, and the DataType's existing `fields`/`computedFields` are
  unchanged

#### Scenario: Agent replaces a DataType's computed fields
- **WHEN** an agent calls `update_data_type` with `computedFields` set to a new array
- **THEN** the DataType's computed fields become exactly that array, not a merge with the
  previous set

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
