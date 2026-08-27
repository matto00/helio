## Why

Agents can quickly research and author sources only if the credential never has to pass through a model
context. Today `create_rest_data_source` (MCP) accepts only `url`/`auth`, forcing an agent to be handed an
API key. The backend already supports Connector-referenced REST sources (HEL-822/826/827, UI parity
shipped) — the MCP surface never adopted it.

## What Changes

- New `list_connectors` MCP tool: id/name/kind/host per Connector, never the credential (distinct from
  HEL-825's `list_connector_types`, which lists kind metadata, not instances).
- `create_rest_data_source` extended to accept `connectorId` + endpoint/method/queryParams/headers/body,
  replacing `url`/`auth`. **BREAKING**: bare `url` is no longer accepted by `POST /api/sources` for
  `rest_api` — rejected at the validation boundary with a clear, actionable error naming `connectorId`
  (decode stays total per HEL-826's invariant; the migration-supporting `ImplicitConnectorConfig`/
  `RestSourceConnectorMigration` machinery is explicitly UNTOUCHED — see design.md for why removal is
  gated on prod having actually run the migration, not on this ticket).
- Agent-creates-a-Connector: explicitly **forbidden**. No MCP tool creates a Connector. Agents reference
  existing Connectors by id only; humans create them via the UI or HEL-829 (out of scope here).
- Connectors surfaced in the assistant's existing workspace-context payload (id/name/kind/host only).
- Tool descriptions state plainly that credentials are never returned.
- Verify (not modify) the in-app top-level assistant surface (`AssistantProposalToolSchemas`/
  `AssistantToolExecutor`, HEL-659) for consistency; report divergence rather than expand scope.

## Capabilities

### New Capabilities
- none (extends existing `mcp-data-source-tools`, `workspace-context-assembly`, and `rest-api-connector` capabilities)

### Modified Capabilities
- `mcp-data-source-tools`: `create_rest_data_source` now takes `connectorId`-based config instead of
  `url`/`auth`; new `list_connectors` tool added.
- `workspace-context-assembly`: workspace context response gains a Connectors block (id/name/kind/host,
  no credential).
- `rest-api-connector`: `POST /api/sources` (`rest_api`) no longer accepts a bare `url` config; requires
  `connectorId`, rejected at the validation boundary (not decode) with an actionable error.

## Impact

`helio-mcp/src/tools/write.ts`, `helio-mcp/src/tools/read.ts`, `helio-mcp/src/types.ts`,
`helio-mcp/src/helioApi.ts`, `helio-mcp/src/context.ts` (its own separate client-side fan-out, distinct
from the backend's `WorkspaceContextResponse`); backend `SourceService.createRest`'s own bare-`url` match
arm only (`backend/src/main/scala/com/helio/services/sources/SourceService.scala`) — `RestApiConfigPayload.
toDomain` is untouched (its own bare-url branch is already dead code on this path); a new slim
`ConnectorSummary` projection type; `WorkspaceContextProtocol`/`WorkspaceContextService`. No frontend
changes expected (HEL-827 already Connector-only). Explicitly untouched:
`RestSourceConnectorMigration`/`ImplicitConnectorConfig`, `SourceService.inferRest`/`testRest`,
`PipelineService.resolveInlineSourceSchema`'s ephemeral branch — see design.md Decision 1.

## Non-goals

UI changes (HEL-827, shipped). OAuth2 (HEL-595). In-chat credential capture (HEL-829). Removing the
legacy-migration machinery (blocked on prod having run it — not this ticket's call).
