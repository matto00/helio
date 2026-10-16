## ADDED Requirements

### Requirement: Workspace-context build survives rate-limited fetches

Building the workspace context (`get_workspace_context` and the `workspace-context` resource) SHALL never leave a
rejected promise unobserved. A failure of the Outputs fetch SHALL degrade only the Outputs section: every pipeline's
`outputs` SHALL be `[]` and the context SHALL carry a top-level `outputsError` string describing the failure (absent
when the Outputs fetch succeeded). A failure of the core fetches (data sources, dashboards, pipelines, pipeline shapes)
SHALL fail the call with the rate-limit error surfaced as an `isError` tool result, and the helio-mcp process SHALL keep
running. The process SHALL also install an `unhandledRejection` handler that logs a bounded message to stderr and keeps
serving.

#### Scenario: Core and Outputs fetches both rate limited past the budget

- **WHEN** `listDataSources` and `listAllOutputs` both answer 429 past the retry budget during `get_workspace_context`
- **THEN** the tool returns an `isError` result whose text names the rate limit
- **AND** no `unhandledRejection` is emitted and the process keeps serving further tool calls

#### Scenario: Only the Outputs fetch fails

- **WHEN** the core fetches succeed and `listAllOutputs` fails
- **THEN** `get_workspace_context` succeeds, every pipeline's `outputs` is `[]`, and `outputsError` carries the failure
  message

#### Scenario: Stray unhandled rejection

- **WHEN** any promise rejection in the helio-mcp process goes unhandled
- **THEN** a bounded line is written to stderr and the process does not exit
