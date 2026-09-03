# HEL-886: An MCP-only agent cannot create a Connector, so it cannot create any REST source at all

## Description

### Observed

Found during the HEL-857 exit-criterion rebuild (Sleeper NFL API, live, against `main` at `c70893be`).

`create_rest_data_source` requires a `connectorId` (HEL-828, `helio-mcp/src/tools/restDataSourceSchema.ts`). Nothing on the MCP surface can produce one. The tool list has `list_connectors` and `list_connector_types` but no create/update/delete. The backend has `POST /api/connectors` (`backend/src/main/scala/com/helio/api/routes/sources/ConnectorEntityRoutes.scala:48` — note the ticket's original path was stale and is corrected here), so this is purely an MCP-layer gap.

Consequence: **an MCP-only client cannot author a REST source from a clean workspace.** The Sleeper rebuild was blocked at step one; the reporter had to `POST /api/connectors` with a PAT out-of-band to proceed. Every downstream check in this epic was reachable only because they stepped outside the surface under test.

### Not a simple "add the tool"

HEL-828 deliberately keeps credentials off the MCP surface, and `createRestDataSourceSchema` is `.strict()` specifically so a credential has nowhere to go. HEL-829 solved connector creation for *in-app chat* with a dynamic credential form that bypasses the agent. There is no equivalent for an MCP-only client, and that is the actual hole. Do not resolve this by putting a `credential` field on an MCP tool — that reverses a decision two shipped tickets made on purpose.

Two sub-cases, and they are not equally hard:

1. **Unauthenticated hosts** (Sleeper is one — the connector's credential is unused). There is no secret to protect, and no reason an agent cannot create this connector itself. This is the case that blocked the epic. Note: the backend already supports this — `ConnectorEntityService.create` permits an empty `credential` when `config.authType == "none"` (HEL-822 CR6).
2. **Credentialed hosts.** Needs an out-of-band capture path analogous to HEL-829 — e.g. the agent creates a credential-less connector in a pending state and returns a URL the human completes. Design work, not a tool addition.

### Discoverability

Independently of the fix: the failure gives an agent nothing to act on. `create_rest_data_source` fails with a Zod error naming `connectorId` as required; `list_connectors` then returns an empty array; there is no message anywhere saying how a connector comes into existence. An agent's only recovery is to give up or leave the surface.

## Acceptance criteria

- [ ] An MCP-only client can create a REST data source against an unauthenticated host, starting from a workspace with zero connectors, using only MCP tools.
- [ ] No MCP tool accepts a credential value, under any key. HEL-828's `.strict()` schema and its `rejectCredentialField` denylist stay intact, demonstrated by a test that survives this change.
- [ ] For a host that does need a credential, the agent gets an actionable next step naming the out-of-band path — not a bare validation error. A pending-connector handoff (à la HEL-829) is the expected shape; if it is deferred, record that decision and file the follow-up.
- [ ] `list_connectors` returning empty, and `create_rest_data_source` failing for a missing `connectorId`, both carry a message that names how to obtain one.
- [ ] Verified by measurement: a scripted MCP session against a clean workspace builds a working REST source end to end with no out-of-band HTTP call. Not by reading the tool list.

## Context

- Ticket type: bug (MCP-layer capability gap). Parent epic: HEL-857. Related: HEL-820, HEL-828, HEL-829.
- Priority: Urgent.
