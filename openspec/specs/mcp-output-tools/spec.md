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

### Requirement: get_output_provenance MCP tool
helio-mcp SHALL expose `get_output_provenance(outputId)` returning the authenticated provenance response unchanged, with tool copy that states the backend's actual status codes as probed against a running backend.

#### Scenario: Agent reads provenance
- **WHEN** an agent calls `get_output_provenance` with a readable Output id
- **THEN** it receives sources, pipeline, node path, last run and assertion counts

#### Scenario: Unreadable Output
- **WHEN** the Output does not exist or is not readable
- **THEN** the tool surfaces the backend's 404 as an error

### Requirement: get_output_history MCP tool

helio-mcp SHALL register a `get_output_history` tool taking `outputId` (required), `limit` (optional integer 1..100),
`since` (optional ISO-8601 instant) and `includeSummaries` (optional boolean, default false). It SHALL issue exactly
one `GET /api/outputs/:id/history` request, forwarding `limit`/`since` as query parameters only when supplied. It SHALL
return that route's response unchanged, except that when `includeSummaries` is not true each `points[]` entry omits
its `summary` field and the resolved `current` and `baseline` objects (when non-null) omit their `series` field. The tool SHALL NOT compute baselines, deltas, percentages or values itself.

The tool description SHALL state that a value is non-null only for metric-kind Outputs. It SHALL state that a
`previous_run` baseline is the second-newest retained history point, which may be older than the immediately
preceding run because older history is thinned. The description SHALL NOT claim the baseline is the previous run.

#### Scenario: Last 30 values in one call

- **WHEN** an agent calls `get_output_history` with `outputId` of a metric Output that has at least 30 retained
  history points and `limit: 30`
- **THEN** exactly one HTTP request `GET /api/outputs/<id>/history?limit=30` is made
- **AND** the result carries 30 `sparkline` entries, each with `capturedAt` and a numeric `value`, and 30 `points`

#### Scenario: Optional parameters omitted

- **WHEN** `get_output_history` is called with only `outputId`
- **THEN** the request carries neither a `limit` nor a `since` query parameter (the backend default applies)

#### Scenario: Summaries trimmed by default

- **WHEN** `get_output_history` is called without `includeSummaries`
- **THEN** no returned `points[]` entry has a `summary` field, neither `current` nor `baseline` has a `series` field, and every other response field is unchanged
- **WHEN** it is called with `includeSummaries: true`
- **THEN** each `points[]` entry carries the backend's `summary` unchanged and `current`/`baseline` carry the backend's `series` unchanged

#### Scenario: Backend errors surface as tool errors

- **WHEN** the backend answers 400 (bad `limit`/`since`) or 404 (unknown or inaccessible Output)
- **THEN** the tool returns an `isError` result carrying the status and the backend message

#### Scenario: Description does not promise "previous run"

- **WHEN** the registered tool list is read
- **THEN** `get_output_history`'s description mentions that non-metric values are null and that history is thinned
- **AND** it does not contain the phrase "previous run"

### Requirement: compare is documented on every Output config write tool

The descriptions of `add_output`, `update_output`, `create_pipeline` and `propose_pipeline` SHALL document the optional
`config.compare` key. They SHALL list its accepted values (`previous_run`, `1d`, `7d`, `30d`, `custom:<ISO-8601
duration>`, or null for none) and state that the backend rejects anything else with a 400. `place_outputs` SHALL NOT
document or accept `compare`. The MCP layer SHALL NOT validate `compare` itself; `config` remains a pass-through record.

#### Scenario: Write tools document compare

- **WHEN** the registered tool list is read
- **THEN** the descriptions of `add_output`, `update_output`, `create_pipeline` and `propose_pipeline` each mention
  `compare` and `previous_run`
- **AND** `place_outputs`' description does not mention `compare`

#### Scenario: compare passes through unvalidated

- **WHEN** `add_output` is called with `config: {compare: "7d"}`
- **THEN** the create request body carries `config.compare` equal to `"7d"`, unchanged

### Requirement: update_output documents the history-payloads opt-in
The helio-mcp `update_output` tool description SHALL document `config.historyPayloads`: it is a boolean opt-in to keep
each real run's full rows; a run over 1,000 rows or 1 MiB keeps only its summary; rows are kept only when the
pipeline owner's tier allows it (free keeps none), and the Output's `historyPayloadsAvailable` field reports that; and
turning it off stops storing rows while stored rows expire on the normal schedule. Sending
`config: {"historyPayloads": true}` through `update_output` SHALL reach `PATCH /api/outputs/:id` unchanged.

#### Scenario: Agent enables payloads
- **WHEN** an agent calls `update_output` with `config: {"historyPayloads": true}`
- **THEN** the PATCH body sent to `/api/outputs/:id` carries `config.historyPayloads === true`, and the updated Output is
  returned

#### Scenario: Description is discoverable
- **WHEN** a client lists tools
- **THEN** `update_output`'s description mentions `historyPayloads`, the 1,000-row / 1 MiB caps, and
  `historyPayloadsAvailable`
