## ADDED Requirements

### Requirement: get_workspace_context excludes types and metrics
`get_workspace_context` SHALL NOT list DataTypes or Metrics. It SHALL list each pipeline with its
Outputs (kind, schema, current placements) and each source with its `inferredSchema`.

#### Scenario: Workspace context omits retired resources
- **WHEN** an agent calls `get_workspace_context`
- **THEN** the response contains no DataType or Metric entries, and each pipeline entry lists its
  Outputs' kind, schema, and placements

### Requirement: get_workspace_context stays under the MCP result cap at realistic scale
`get_workspace_context` SHALL remain under the MCP result-size cap for a workspace of 25 sources
and 43 pipelines.

#### Scenario: Large workspace fixture stays under cap
- **WHEN** `get_workspace_context` is called against a fixture workspace with 25 sources and 43
  pipelines
- **THEN** the response size is under the MCP result cap
