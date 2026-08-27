# HEL-828: Connectors on the agent/MCP surface: author sources against a Connector without ever handling the secret

## Description

Child 7 of HEL-820. Depends on children 3 and 4.

The stated goal is that agents can quickly research and author sources. The security property and the authoring-speed property are the same property: if the credential lives on a Connector the human created, an agent can compose a complete, working source without ever seeing, requesting, or transmitting a secret.

Today an agent calling `create_rest_data_source` must be handed an API key to pass in — which means the key travels through a model context. Under this epic it never needs to.

## Scope

- List Connectors — MCP tool returning the caller's Connectors: id, name, kind, base host. Never the credential, in any form, including partially masked.
- Create a source against a Connector — extend/replace `create_rest_data_source` to take `connectorId` + endpoint + method + params + body + response shaping, instead of url + auth.
- Creating a Connector from an agent — decide deliberately whether this is allowed at all. Options: forbid it (humans only, since a credential is involved); allow creating one with a placeholder the human fills in; allow full creation with the secret passed through. Recommendation: forbid or placeholder-only. If allowed, justify it explicitly.
- Workspace context — Connectors should appear in whatever context the assistant already assembles about the workspace, so an agent can see what it can build against without a separate call.

## Coordinate with child 0

Child 0 (HEL-825) decides the `/api/connectors` and `list_connectors` naming. This ticket inherits that decision — do not re-litigate it, and do not ship a tool name that contradicts it. (Verified against tree: HEL-825 named the kind-metadata tool `list_connector_types`; the real Connector-instance-listing tool this ticket adds should be named `list_connectors`, consistent with that decision — `list_connectors` is currently unused/available.)

## Acceptance criteria

- [ ] An agent can list Connectors and author a complete, working REST source against one
- [ ] Demonstrated end to end: an agent creates a source against an existing Connector and the source successfully fetches — proven with a real run, not a unit test
- [ ] No credential reaches the agent surface. Enumerate every MCP tool result and workspace-context payload that could carry Connector data and verify each; state the enumeration was checked in both directions
- [ ] The agent-creates-a-Connector decision is made and justified
- [ ] Tool descriptions state plainly that credentials are never returned, so a model does not waste turns trying to retrieve one
- [ ] Naming consistent with child 0's decision

## Out of scope

UI (child 6, HEL-827 — already shipped). OAuth2 flows (HEL-595, v1.9) — an agent cannot complete an interactive auth-code flow anyway, worth noting when that lands. HEL-829 (in-chat credential capture) — builds on this ticket, out of scope here.

## Verified-against-tree findings (Setup premise validation)

- No `list_connectors` MCP tool exists today. Only `list_connector_types` (kind metadata, no instances) exists in `helio-mcp/src/tools/read.ts`.
- `create_rest_data_source` (helio-mcp/src/tools/write.ts) still takes `url`/`method`/`headers`/`auth` only — no `connectorId` support at all on the MCP surface.
- The backend already supports `connectorId`-based REST source creation (`RestApiConfigPayload.connectorId`, `POST /api/sources`) — HEL-822/826/827 built this for the UI. The MCP tool just never adopted it.
- The in-app top-level assistant (`AssistantProposalToolSchemas`/`AssistantToolExecutor`, HEL-659 surface, backend-side, distinct from `helio-mcp/`) ALREADY advertises a `{connectorId, endpoint?, method?, queryParams?, headers?}` rest_api config shape and already forbids raw url. That surface is NOT this ticket's target — `helio-mcp/` (the actual MCP server binary) is.
- Backend bare-`url` dual-support is still live (`SourceService`/`ImplicitConnectorConfig`/`RestSourceConnectorMigration` synthesize an implicit Connector from a legacy `url` before the decode/resolve choke point). HEL-827 deferred deciding whether to retire backend acceptance of this shape to this ticket, per the ticket brief above — this is a breaking wire-contract change to be escalated, not decided unilaterally.
- GET /api/connectors (ConnectorRoutes.scala) — real Connector CRUD from HEL-821/824 — never returns the credential on any read path already (verify in execution, do not assume).
