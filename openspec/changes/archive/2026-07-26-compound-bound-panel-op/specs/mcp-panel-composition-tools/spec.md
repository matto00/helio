## ADDED Requirements

### Requirement: create_bound_panel collapses the source-to-bound-panel chain into one call

The MCP server SHALL expose a `create_bound_panel` tool wrapping `POST /api/panels/bound`,
accepting the same `{ dashboardId, source|sourceDataSourceId, pipeline, panel, fieldMapping? }`
shape and returning `{ sourceId, pipelineId, dataTypeId, panel }`. The tool description SHALL
document that this is the preferred one-call path for building a single bound data panel, and that
the existing granular tools (`create_data_source`, `create_pipeline`, `add_pipeline_step`,
`run_pipeline`, `create_panel`, `bind_panel`) remain available and unchanged for callers that need
finer-grained control (e.g. an existing pipeline they only want to re-run).

#### Scenario: Agent builds one panel in a single tool call
- **WHEN** an agent calls `create_bound_panel` with an inline `source`, one `filter` step, and a
  `metric` panel spec with a satisfiable `fieldMapping`
- **THEN** the tool makes exactly one HTTP request to `POST /api/panels/bound` and returns the
  created `panel` with `dataTypeId` set, replacing what previously required 6 separate tool calls

#### Scenario: Failure surfaces the failed stage verbatim
- **WHEN** the backend rejects the request naming a failed stage (e.g. `"run"`)
- **THEN** the tool surfaces that stage and message to the agent verbatim, matching every other
  write tool's error-passthrough convention in `helio-mcp/src/tools/write.ts` — never swallowed or
  retried silently
