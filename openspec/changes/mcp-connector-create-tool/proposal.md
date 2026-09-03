## Why

An MCP-only client cannot author a REST data source from a clean workspace. `create_rest_data_source`
requires a `connectorId` (HEL-828), and nothing on the MCP surface can produce one — `list_connectors`
and `list_connector_types` are the only Connector tools, and the spec explicitly forbids a create tool.
HEL-857's exit-criterion rebuild was blocked at step one and only proceeded because the operator stepped
outside the surface under test with an out-of-band `POST /api/connectors`. Independently, the failure is
undiscoverable: a Zod error naming `connectorId`, then an empty array, with nothing anywhere saying how a
Connector comes into existence.

The forbidding requirement was written to protect one specific property — a secret must never pass through
a model context. That property does not apply to an unauthenticated host, where there is no secret at all.
The backend already agrees: `ConnectorEntityService.create` accepts an empty `credential` when
`config.authType == "none"` (HEL-822 CR6). The gap is purely MCP-layer.

## What Changes

- Add a `create_connector` MCP tool that creates **credential-less Connectors only** (`authType: "none"`).
  Its input schema is `.strict()` and carries the same always-rejecting credential denylist HEL-828
  introduced, so no secret can be supplied under any key.
- When an agent asks for a Connector that needs a credential, the tool refuses **without creating
  anything** and returns an actionable next step naming the out-of-band path (the in-app `/connectors`
  page, HEL-824/HEL-829) — not a bare validation error. The pending-connector handoff is deliberately
  deferred to a follow-up ticket; that decision is recorded in `design.md`.
- Make the existing dead end discoverable: `list_connectors` returning empty, and `create_rest_data_source`
  failing for a missing/blank `connectorId`, both name `create_connector` as the way to obtain one.
- **MODIFIED (not reversed) security requirement**: creating a *credential-bearing* Connector from MCP
  stays forbidden, and credential rotation stays forbidden. Only the credential-less case is unlocked.
- Add a scripted MCP e2e proving a clean workspace reaches a working REST source with no out-of-band HTTP.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mcp-data-source-tools`: narrows "Creating a Connector from the MCP surface is forbidden" to
  credential-bearing Connectors; adds a `create_connector` tool requirement, a credentialed-host
  actionable-refusal requirement, and discoverability requirements on `list_connectors` and
  `create_rest_data_source`.

## Impact

- `helio-mcp/src/tools/` — new `connectorSchema.ts` + `create_connector` registration in `write.ts`;
  `read.ts` `list_connectors` empty-result hint; `restDataSourceSchema.ts` `connectorId` message.
- `helio-mcp/src/helioApi.ts` / `types.ts` — a `createConnector` client method over `POST /api/connectors`.
- `helio-mcp/e2e/` — new clean-workspace REST-authoring script.
- No backend change: `POST /api/connectors` and its `authType: "none"` empty-credential path already exist.

## Non-goals

- Any MCP tool that accepts a credential value, under any key.
- Connector update, delete, or credential rotation from MCP.
- The pending-connector / human-completes-a-URL handoff (HEL-829 analogue) — deferred, follow-up filed.
- Any change to `POST /api/connectors` or its egress guard (HEL-879).
