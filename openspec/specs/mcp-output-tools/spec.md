# mcp-output-tools Specification

## Purpose
Expose Outputs (P1.1-P1.3) as a first-class MCP resource: create/read/update/delete an Output,
preview it, inspect its available capabilities, and place it on a dashboard — the Output-centric
replacement for the retired DataType/Metric/panel-binding tool surface.

## Requirements

### Requirement: add_output / update_output / delete_output / list_outputs MCP tools
The MCP server SHALL expose `add_output` over `POST /api/pipelines/:id/outputs`, `update_output`
and `delete_output` over `PATCH/DELETE /api/outputs/:id`, and `list_outputs` accepting an optional
`pipelineId` (and optional `nodeStepId`, only meaningful alongside `pipelineId`): when `pipelineId`
is given, `list_outputs` calls the scoped `GET /api/pipelines/:id/outputs?nodeStepId=`; when
omitted, it calls the caller-wide lean-paginated `GET /api/outputs` (no pipeline/node filter exists
on that route), returning that route's `PagedResult` envelope unmodified.

#### Scenario: Agent adds an Output to an existing pipeline node
- **WHEN** an agent calls `add_output` with a `pipelineId`, target `stepId`, `kind`, and
  `fieldMapping`
- **THEN** the tool calls the backend Output-create route and returns the created Output,
  including its assigned `outputId`

#### Scenario: Agent lists Outputs scoped to one pipeline
- **WHEN** an agent calls `list_outputs` with a `pipelineId`
- **THEN** the tool calls `GET /api/pipelines/:id/outputs` and returns only that pipeline's Outputs

#### Scenario: Agent lists all Outputs it owns, across pipelines
- **WHEN** an agent calls `list_outputs` with no `pipelineId`
- **THEN** the tool calls the caller-wide `GET /api/outputs` and returns its paginated envelope
  unmodified

### Requirement: get_output_rows MCP tool
The MCP server SHALL expose `get_output_rows`, replacing `get_data_type_rows`, calling the
paginated `GET /api/outputs/:id/rows` route and returning its envelope unmodified.

#### Scenario: Agent reads an Output's materialized rows
- **WHEN** an agent calls `get_output_rows` with a valid `outputId`
- **THEN** the tool returns the paginated row envelope from the backend, unmodified

### Requirement: preview_outputs MCP tool
The MCP server SHALL expose `preview_outputs(pipelineId, outputId?)` over
`POST /api/pipelines/:id/preview?outputId=`, passing `outputId` through unchanged when present and
omitting the query param when absent, returning the `{outputs: [{outputId, preview}]}` envelope
verbatim in both arms.

#### Scenario: Agent previews a single Output
- **WHEN** an agent calls `preview_outputs` with `pipelineId` and `outputId`
- **THEN** the tool returns a `{outputs: [...]}` envelope containing exactly that Output's preview

#### Scenario: Agent previews all Outputs on a pipeline
- **WHEN** an agent calls `preview_outputs` with only `pipelineId`
- **THEN** the tool returns a `{outputs: [...]}` envelope containing every Output's preview, in the
  same shape as the single-Output arm

### Requirement: Output grounding covers both step-targeted and source-attached Outputs
Output `fieldMapping` validation SHALL ground a step-targeted Output (`nodeStepId` set) against
`PipelineAnalyzeService.analyzeNodes`' projection at that node, and a source-attached Output
(`nodeStepId: null`) against the source's own `inferredSchema`, since `analyzeNodes` does not cover
the source itself.

#### Scenario: A source-attached Output is validated against the source's inferredSchema
- **WHEN** an Output with `nodeStepId: null` is validated
- **THEN** its `fieldMapping` is checked against the pipeline's source `inferredSchema`, not
  against any `analyzeNodes` result

### Requirement: get_output_capabilities MCP tool
The MCP server SHALL expose `get_output_capabilities(pipelineId, stepId?)`, replacing
`get_panel_capabilities`, over `GET /api/pipelines/:id/capabilities?stepId=`.

#### Scenario: Agent inspects capabilities at a specific node
- **WHEN** an agent calls `get_output_capabilities` with `pipelineId` and `stepId`
- **THEN** the tool returns the capabilities available at that node, not the pipeline trunk

### Requirement: add_outputs_from_shape MCP tool
The MCP server SHALL expose `add_outputs_from_shape(pipelineId, stepId?, shape, params)`,
replacing `create_pipeline_from_shape`, instantiating a shape's Outputs onto an existing pipeline
node.

#### Scenario: Agent instantiates a shape's Outputs onto an existing pipeline
- **WHEN** an agent calls `add_outputs_from_shape` with a valid `pipelineId`, `shape`, and `params`
- **THEN** the tool creates the shape's Outputs on that pipeline and returns them

### Requirement: place_outputs and create_content_panel MCP tools
The MCP server SHALL expose `place_outputs(dashboardId, [{outputId, title?, w?, h?}])`, replacing
`create_panel`/`create_panels`/`bind_panel`/`create_bound_panel`, and `create_content_panel` for
non-Output (markdown/divider/image) panels.

#### Scenario: Agent places multiple Outputs on a dashboard in one call
- **WHEN** an agent calls `place_outputs` with a `dashboardId` and an array of `{outputId}` entries
- **THEN** the tool creates one placement per entry and returns the created panels

### Requirement: create_pipeline single-call tool
`create_pipeline` SHALL accept a non-empty `roots` array in place of the singular `source` object. Each element SHALL be either an existing caller-owned `sourceId` or an inline new-source spec, never both and never neither, as the singular `source` required. The tool description SHALL state that a step with no `parentStepId` attaches to a named root, and SHALL NOT describe a pipeline as having one raw source.

#### Scenario: One call builds a two-root pipeline
- **WHEN** `create_pipeline` is called with two roots, a lane under each, and a rejoin `join` consuming the second lane
- **THEN** one pipeline is created with both roots, both lanes, and the rejoin

#### Scenario: A singular source argument is rejected
- **WHEN** `create_pipeline` is called with a `source` object and no `roots`
- **THEN** the call fails with a named error and creates nothing

#### Scenario: Agent builds a pipeline with steps and outputs in one call, via an existing source
- **WHEN** an agent calls `create_pipeline` with a `sourceId`, a `steps` array containing a step
  with `parentStepId` referencing an earlier step, and an `outputs` array
- **THEN** the tool issues one `POST /api/pipelines` call and returns the created pipeline with its
  steps and outputs

#### Scenario: Agent builds a pipeline from an inline source spec in one tool call
- **WHEN** an agent calls `create_pipeline` with an inline source spec instead of `sourceId`
- **THEN** the tool creates the source via `POST /api/data-sources`, then the pipeline via
  `POST /api/pipelines` using that source's id, returning both as if from a single call

#### Scenario: Pipeline creation fails after an inline source was already created
- **WHEN** the `POST /api/pipelines` call fails after `create_pipeline` already created an inline
  source
- **THEN** the tool's error response includes the orphaned data source's id so it can be cleaned
  up

### Requirement: Removed tools have no aliases
The MCP server SHALL NOT expose `list_data_types`, `update_data_type`, `delete_data_type`,
`get_data_type_rows`, `list_metrics`, `get_metric`, `create_metric`, `update_metric`,
`delete_metric`, `bind_panel`, `create_bound_panel`, or `get_panel_capabilities`, and SHALL NOT
register any alias for them.

#### Scenario: Tool list excludes every removed tool
- **WHEN** the MCP server's tool list is enumerated
- **THEN** none of the removed tool names, nor any alias for them, appears
