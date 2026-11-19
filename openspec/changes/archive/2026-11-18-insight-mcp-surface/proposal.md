## Why

Insight Outputs (HEL-1740/1742/1743) and ask-your-data (HEL-1745) are live in the REST API and web UI, but an MCP agent
cannot create an insight Output, read or refresh its narrative, or ask a dashboard a question. HEL-921's agent exit
criterion (add an insight to an existing pipeline, get a cited narrative, ask a question on a dashboard) is unmet.

## What Changes

- `insight` joins every Output kind enum in helio-mcp (add_output, add_outputs_from_shape, create_pipeline,
  propose_pipeline and its types), with the insight config keys documented on the config-writing tools.
- New tool `get_output_insight(outputId)` wrapping `GET /api/outputs/:id/insight` (role-shaped read, never renders).
- New tool `refresh_insight(outputId)` wrapping `POST /api/outputs/:id/insight/refresh` (202, asynchronous).
- New tool `ask_dashboard(dashboardId, question)` wrapping `POST /api/dashboards/:id/ask`, in a new `ask.ts`.
- A drift test pins every helio-mcp kind enum to the backend schema's kind enum.
- `place_outputs` is proven kind-agnostic for an insight Output (test only).
- The exit criterion is a scripted test that drives the real MCP server against a fake Helio backend whose bodies
  are what the real routes write with a scripted (fake) model, pinned by a backend seam spec.

## Capabilities

### New Capabilities
- `mcp-insight-tools`: MCP tools to read and refresh an insight Output's narrative and to ask a dashboard a question.

### Modified Capabilities
- `mcp-output-tools`: Output-writing tools accept and document the `insight` kind.

## Non-goals

- No backend behavior change, no Flyway migration, no web UI change.
- No `ask_output` tool (the ticket names `ask_dashboard` only) and no model picker on ask (owner ruling: server model).
- No in-app assistant proposal-surface change (`AssistantProposalToolSchemas` keeps its kind list).
- No rebuild of the session MCP `dist`, no `deploy-mcp.sh`, no live model call.

## Impact

- `helio-mcp/src/tools/{outputs,pipelines,pipelineProposal,ask}.ts`, `helio-mcp/src/{helioApi,types,server}.ts`, new
  helio-mcp tests.
- `shared-test-fixtures/insight/` (new) plus a backend test-only seam spec; one stale backend comment.
- `helio-mcp/README.md` tool list, `docs/agent-native.md` tool-to-route table, `EXPECTED_TOOL_NAMES` in
  `helio-mcp/src/server.test.ts`.
