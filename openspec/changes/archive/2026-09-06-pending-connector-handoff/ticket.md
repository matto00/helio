# HEL-955: Pending-connector handoff: let an MCP agent start a credentialed Connector that a human completes out-of-band

## Description

Deferred deliberately from HEL-886 (that change's `design.md` Decision 7). HEL-886 closed the
**unauthenticated** half of the MCP connector gap: an MCP-only agent can now create a credential-less
Connector (`authType: "none"`) via `create_connector` and author a REST source from a clean workspace.

The **credentialed** half remains open. Today, when an agent indicates the target host needs auth,
`create_connector` refuses without creating anything and returns an actionable message naming the in-app
`/connectors` page. That is a signpost, not a handoff — the agent's workflow still dead-ends and a human
must context-switch to the UI and re-establish what the agent was trying to build.

This is the HEL-829 analogue for MCP-only clients: the agent creates a **pending**, credential-less
Connector and receives a URL a human completes out-of-band, after which the agent's flow resumes against a
now-usable `connectorId`.

This is design work, not a tool addition. It needs at minimum:

* A pending state on the Connector entity (a row that exists but cannot yet be used to author a source),
  and enforcement that a pending Connector is rejected by the source-creation path.
* A completion URL, its token/scoping model, and an expiry — a pending Connector must not be an
  indefinitely-open slot for an unauthenticated party to attach a credential to.
* The UI that consumes that URL (HEL-829's dynamic credential form is the obvious starting point, since it
  already captures a credential while bypassing the agent entirely).
* A story for how the agent learns completion happened — poll, or accept that the next
  `create_rest_data_source` call simply succeeds.

## Non-negotiable constraint (inherited)

No MCP tool may accept a credential value, under any key. HEL-828's `.strict()` schemas and the shared
`rejectCredentialField` denylist (`helio-mcp/src/tools/credentialDenylist.ts`, extracted by HEL-886) stay
intact. The whole point of a pending-connector handoff is that the secret reaches the backend by a path the
model context never touches.

## Acceptance criteria

- [ ] An MCP-only agent can initiate a Connector for a credentialed host and receive a completion URL.
- [ ] A human completing that URL supplies the credential without the value ever passing through an MCP tool.
- [ ] A pending Connector cannot be used to author a data source until it is completed.
- [ ] The completion URL expires, and expiry behavior is specified and tested.
- [ ] HEL-828's denylist and `.strict()` guarantees still hold, demonstrated by tests that survive the change.

## Validated premise (Setup, CON-136)

Probed against the live tree at base commit `8231b191`:

* `create_connector`'s refusal is real and pre-HTTP — `helio-mcp/src/tools/connectorHandlers.ts:38`.
* No pending state exists. `connectors.credential_id` is `NOT NULL` (V93) and `Connector.credentialId` is
  non-optional. **A migration is required; the max applied version on main is V102, so this change derives
  V103 — re-derive from the tree at the moment of writing, and never edit an applied migration.**
* `ConnectorEntityService.create` rejects an empty credential unless `authType == "none"`. Do **not** relax
  that check to express pending-ness; a pending Connector must be a distinct, structurally-enforced state.
* HEL-845 (`SourceService.checkConnectorKind`) is **orthogonal** — it rejects a *kind* mismatch, not
  credential absence. The pending guard on the source-creation path is new work, not an extension of it.
* HEL-829's `InlineConnectorSetup.tsx` / `ConnectorCredentialField.tsx` already capture a credential while
  bypassing the agent — reuse the form; the tokenized completion route/expiry is what is missing.
* **HEL-590 (`e01aa6d4`, migrations V101/V102 `share_tokens`) is the precedent to mirror** for the
  completion URL's token/expiry/revocation model. Do not invent a second token scheme; read that code first.

## Binding constraints for this change

* `CONTRIBUTING.md` — no inline fully-qualified names in Scala.
* Keep `schemas/` and `openspec/` in the same change as the client/server code (CLAUDE.md API-contract rule).
* `DESIGN.md` — binding for all `frontend/` work.
* Envelope encryption is already in place (`CONNECTOR_MASTER_KEY`, per-row `key_id`); credential writes fail
  hard rather than falling back to plaintext. **Do not introduce a path that writes a credential any other way.**
* CI selects only `frontend/**` and `backend/**` — **nothing selects `helio-mcp/**`** (HEL-1004). If this
  change touches `helio-mcp/`, run its tests and typecheck explicitly and say so.
* Concurrent runs: HEL-1003 owns `ActionsMenu`/`MobileNavSheet`; HEL-865 may start in the MCP concise-modes
  area. Do not modify those files — escalate instead of racing.
