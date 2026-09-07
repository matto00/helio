# Pending-connector handoff

## Why

An MCP-only agent cannot stand up a REST source against a host that needs auth. HEL-886 closed the
unauthenticated half (`authType: "none"`); for anything credentialed, `create_connector` refuses without
creating a row and points at the in-app `/connectors` page. That is a signpost, not a handoff: the agent's
work is lost and a human must reconstruct from scratch what the agent was trying to build. The secret must
never reach the model context (HEL-828), so the fix is not "let the tool take a credential" — it is to let
the agent create a **pending** Connector and hand a human a URL that completes it out of band.

## What Changes

- A Connector gains an explicit **pending** state: a row that exists, is owner-scoped, carries its
  non-secret identity (name, kind, base URL, auth shape), and has **no credential bound**. Structurally
  enforced — `credential_id` becomes nullable and the domain type carries `Option`, so "pending" is
  unrepresentable-as-usable rather than a boolean anyone can forget to check.
- **Every** Connector consumption chokepoint rejects a pending Connector: the REST source-creation path
  (alongside, not folded into, HEL-845's orthogonal kind check) and the fetch-time driver resolution —
  before URI composition and before any credential decryption. The SQL driver is deliberately *not* a
  chokepoint: it holds no `ConnectorRepository` and carries its own credentials, so it has nothing to guard.
- A **completion token**: single-purpose, bound to one pending Connector, cryptographically unguessable,
  expiring, single-use, and revoked on use. Mirrors the `share-link-tokens` contract shipped by HEL-590
  rather than inventing a second token scheme.
- A **completion endpoint + page** that accepts the credential from a human and binds it through the
  existing envelope-encryption write path. No new credential-write path is introduced.
- `create_connector` stops refusing credentialed hosts: it creates the pending Connector and returns the
  completion URL and `connectorId`. It still accepts no credential under any key — HEL-828's `.strict()`
  schemas and `rejectCredentialField` denylist are unchanged and re-asserted by tests.
- The agent learns of completion by the source-creation call simply succeeding. Pendingness is also
  visible in the existing Connector list (no separate status endpoint is added), deliberately without
  exposing anything a human is mid-configuring.

## Capabilities

### New Capabilities
- `connectors/pending-connector-handoff`: the pending Connector state, the chokepoints that must reject it,
  and the agent-facing initiation contract.
- `connectors/connector-completion-token`: the completion token's generation, scoping, single-use, expiry
  and non-disclosure contract, and the out-of-band completion endpoint.

### Modified Capabilities
- `connectors/connector-management`: the CRUD lifecycle now admits a credential-less pending state and its
  transition to active.
- `connectors/connector-credential-binding`: credential binding may now occur after creation, via the
  completion path, still fail-closed and still never returned on any read path.
- `mcp-data-source-tools`: `create_connector` initiates a credentialed Connector instead of refusing.

## Impact

- **Migration** (new, derived from the tree at authoring time — main is at V102): make
  `connectors.credential_id` nullable, add the completion-token table with its RLS policy and privileged
  grant, following V101/V102's pattern.
- **Backend**: `Connector` domain type, `ConnectorRepository`, `ConnectorEntityService`, `SourceService`,
  `RestApiConnectorDriver`, `SqlConnectorDriver`, connector protocols and routes, plus a new
  optional-auth completion route tree.
- **Frontend**: a completion page consuming the URL, reusing HEL-829's `ConnectorCredentialField`.
- **helio-mcp**: `connectorSchema.ts`, `connectorHandlers.ts`. CI selects neither — its tests and typecheck
  must be run explicitly (HEL-1004).
- `schemas/sources/` and `openspec/` wire contracts change in this same change.

## Non-goals

- No polling/notification tool for the agent, and no webhook — completion is observed by the next
  source-creation call succeeding.
- No change to envelope encryption, key rotation, or `CONNECTOR_MASTER_KEY` handling.
- No relaxation of the existing "credential required unless `authType: none`" rule on the direct
  authenticated `POST /api/connectors` path; pending-ness is a distinct state, not a relaxation.
- Not a general resumable-handoff mechanism for other resource types.
