## Context

`GET /api/connectors` (HEL-821) already returns `ConnectorMeta` — id/ownerId/name/kind/baseUrl/config/
timestamps/dependentCount, structurally incapable of carrying a credential (`ConnectorEntityProtocol.scala`).
`POST /api/sources` already accepts `connectorId`-based `rest_api` config (HEL-822/826/827). The gap is
entirely on the MCP surface (`helio-mcp/`): no tool lists Connector instances, and `create_rest_data_source`
still only knows `url`/`auth`. `AssistantProposalToolSchemas`/`AssistantToolExecutor` (the in-app top-level
assistant, HEL-659, backend-side) is a distinct surface that already speaks `connectorId` — not modified
here, only verified for consistency.

## Goals / Non-Goals

**Goals:**
- `list_connectors` MCP tool: id/name/kind/host, zero credential exposure.
- `create_rest_data_source` accepts `connectorId` + endpoint/method/queryParams/headers/body/rootSelector.
- Backend `POST /api/sources` (`rest_api`) rejects bare `url` at the validation boundary with an actionable
  error naming `connectorId`.
- Connectors surfaced in `WorkspaceContextResponse` (id/name/kind/host).
- Verify `AssistantProposalToolSchemas`/`AssistantToolExecutor` for consistency; report divergence, don't fix.

**Non-Goals:**
- Any MCP tool that creates/updates a Connector or its credential (forbidden — Decision 2).
- Touching `RestSourceConnectorMigration`/`ImplicitConnectorConfig` (Decision 1).
- UI changes (HEL-827 shipped this already).
- OAuth2 (HEL-595), in-chat credential capture (HEL-829).
- Fixing the Connector-picker kind-filter gap noted by HEL-827's final gate (confirm/report only, per
  the coordinator's brief — out of scope to fix here unless it falls out naturally).

## Decisions

### Decision 1 — Retire bare-`url` at the WIRE BOUNDARY (`SourceRoutes`), not the shared service method
**Revised during execution (round-2 correction, superseding the round-1 skeptic's edit-site finding below).**
The executor found a real caller the original enumeration missed: `PipelineProposalService.resolveRestSource`
(backend NL-authoring proposal-apply path, `POST /api/pipelines/apply-proposal`) calls
`SourceService.createRest` directly with an inline bare-`url` config for un-sourced proposal sources. This
path is reachable by an external agent authenticating with a PAT via `helio-mcp`'s own `propose_pipeline`/
`apply_pipeline_proposal` tools (`helio-mcp/src/tools/pipelineProposal.ts`/`pipelineProposalHandlers.ts`) —
**verified**, not assumed — so it is live agent traffic, not dead code covered only by stale tests. An
earlier draft of this decision assumed `AssistantProposalToolSchemas`'s already-`connectorId`-only shape
meant no caller still needed bare-`url` here; that assumption was wrong because it only accounted for the
in-app assistant surface, not the separate MCP `propose_pipeline`/`apply_pipeline_proposal` path.

Retiring bare-`url` inside `SourceService.createRest` itself would therefore have broken real agent-authored
pipeline proposals against a public, no-auth REST API — and there is a product reason that must stay
possible: Decision 2 forbids agents from creating Connectors (a Connector-creation call would push a secret
through model context). If `apply-proposal`'s inline REST-source resolution also required a pre-existing
`connectorId`, an agent could no longer author a pipeline against a no-auth public API at all without a
human first creating a placeholder Connector for it — a capability regression on shipped HEL-342 behavior,
buying no security benefit, since there is no credential anywhere on that path.

**Correct edit site: `SourceRoutes` (`POST /api/sources`'s HTTP shell), not `SourceService.createRest`.**
`SourceService.createRest`'s `(None, Some(url))` match arm is **reverted to its original behavior** —
synthesizing an implicit no-auth Connector, exactly as before this ticket — so `PipelineProposalService`
(an internal, service-to-service caller) keeps working unmodified. The wire-contract rejection this ticket
actually wants happens instead at `SourceRoutes`: before constructing the `CreateSourceRequest` it hands to
`sourceService.createRest`, the route SHALL reject a `rest_api`-typed body whose `config` carries a bare
`url` (no `connectorId`) with 400, naming `connectorId` explicitly and explaining how to create a Connector
first. This satisfies HEL-826's invariant unambiguously: decode (`RestApiConfigPayload`'s own decoder, and
`CreateSourceRequest.convertTo` in the route) stays completely total and unmodified; this is a create-time
validation-boundary check at the HTTP shell, structurally identical in kind to the existing
`buildResolvedRequest`/`buildEphemeralRequest` choke points, just at the one additional entry point
(`POST /api/sources` itself) that sits in front of the shared service method rather than inside it.
`RestApiConfigPayload.toDomain`'s own `(None, Some(_))` branch remains unreachable dead code on the
`createRest` path, exactly as previously established, and is untouched either way.

**`PipelineProposalService`'s inline bare-`url` support is a deliberate, documented exception, not an
oversight left over.** It exists because agents cannot create Connectors (Decision 2) and a no-auth public
API should still be pipeline-authorable by an agent. Converging this onto Connector-only source creation
needs its own design — a lightweight/ephemeral or agent-visible Connector story for pipeline proposals —
which is out of scope here and not this orchestrator's call to file; reported to the coordinator instead.

**Explicitly untouched — enumerated, not just "the migration":**
- `RestSourceConnectorMigration`/`ImplicitConnectorConfig` — converts **already-persisted** legacy-shaped rows
  to reference a real Connector, once, at backend startup. Per the coordinator: `release/v1.7` is 22 commits
  behind main and does not contain HEL-822 (`git branch -r --contains e5d84a5c` excludes it) — this migration
  has never executed against production, and prod's existing REST sources are still stored in the legacy
  inline shape awaiting it. Removing this machinery now, followed by a release cut, would strand every legacy
  production REST source, decoding into HEL-822's `__unmigrated__`/`__malformed__` sentinels — silent data
  loss that would look like sources simply stopped working.
- `SourceService.inferRest`/`SourceService.testRest` — ephemeral (ie non-persisting) infer/test-connection
  calls that resolve a bare `url` on the fly, ie never write a Connector row. Existing spec requirement
  "Infer and test-connection accept the legacy bare-url shape ephemerally" is NOT modified by this change.
- `PipelineService.resolveInlineSourceSchema`'s own `(None, Some(url))` ephemeral branch — a pipeline
  proposal is provisional and never persists a Connector either. Untouched.
- `SourceService.createRest` itself (reverted to original, as above) and `PipelineProposalService.
  resolveRestSource` (never modified) — both keep accepting bare `url` as internal callers, unaffected by
  the wire-boundary rejection this ticket adds at `SourceRoutes`.

**Precondition for ever removing the migration** (recorded here for whoever does it later, checkable, not
date-based): production must have deployed a build containing `RestSourceConnectorMigration` (at least
HEL-822's commit) AND the migration must have actually run at that deploy's backend startup. Only then is it
safe to delete the migration and its supporting `ImplicitConnectorConfig` type. This ticket does not touch
that decision at all.

### Decision 2 — Agent-creates-a-Connector: forbidden
Confirmed by the coordinator. No MCP tool creates or updates a Connector. The reason is structural, not
merely a policy preference: creating a Connector requires supplying a secret, and any tool accepting one
would route that secret through a model context — the exact thing this entire epic exists to avoid. Agents
reference existing Connectors by id (via `list_connectors`); humans create Connectors via the UI (HEL-824)
or HEL-829's in-chat capture flow, which is explicitly designed to bypass the agent.

### Decision 3 — `list_connectors` distinct from `list_connector_types`
HEL-825 already claimed `list_connector_types` for kind-capability metadata (no instances). This ticket adds
`list_connectors` for actual Connector instances — consistent naming, no collision, matches the ticket's own
"coordinate with child 0" instruction.

### Decision 4 — MCP tool shapes carry no `url`/`auth` fields at all
`create_rest_data_source`'s Zod input schema drops `url`/`method`(kept)/`headers`(kept)/`auth` entirely and
adds `connectorId` (required), `endpoint`/`queryParams`/`body`/`bodyContentType`/`rootSelector` (optional).
The built schema is `.strict()` (skeptic-final-1.md round 1): any key not named above — including a bare
`url` and any credential-shaped name, not just the 5 explicitly denylisted (`auth`/`apiKey`/`token`/
`password`/`credential`, which get a better, connectorId-naming error message) — fails the parse. An agent
instructed to "pass the API key inline" has nowhere to put it, under any name, and the call fails loudly
rather than silently dropping the field — this is the demonstrable (not merely asserted) enforcement the
ticket calls for.

### Decision 5 — Workspace context gains Connectors on BOTH surfaces (round-1 skeptic correction)
There are two distinct "workspace context" things, and the MCP surface — this ticket's actual target — is
the client-side one, not the backend one:
- **Backend `WorkspaceContextResponse`** (`WorkspaceContextService`/`WorkspaceContextProtocol.scala`) — used
  by the in-app top-level assistant's own grounding (`RefinementGrounding.scala` et al). Gains a `connectors`
  field: id/name/kind/baseUrl only (see Decision 6's slim projection — never `ConnectorMeta` verbatim).
- **`helio-mcp/src/context.ts`** (`get_workspace_context` MCP tool / `helio://workspace/context` resource) —
  its own header comment confirms it is an INDEPENDENT CLIENT-SIDE FAN-OUT over REST endpoints, never reads
  the backend's `WorkspaceContextResponse` internally. This is the actual MCP-agent-facing surface the ticket's
  acceptance criteria is about. It gains its own additional fan-out call (`GET /api/connectors`, reusing
  `helioApi.ts`) and serializes the same slim id/name/kind/host projection into its returned context payload.

Both are added — the backend field because the ticket's "workspace context" language applies to the in-app
assistant surface too and it's a one-line, no-new-query-path addition (`ConnectorEntityService`'s existing
owner-scoped list), and the `context.ts` fan-out because that is the one MCP agents actually receive.

### Decision 6 — Never reuse `ConnectorMeta` verbatim; slim, credential-safe projection only
Round-1 skeptic finding: `ConnectorMeta.config` is `ConnectorAuthShape` JSON, and `ConnectorAuthShape.defaultHeaders:
Map[String,String]` is free-form, user-supplied headers merged into every outbound request
(`RestApiConnectorDriver.scala:143`) — it can literally hold `"Authorization" -> "Bearer sk-..."` if that's how
the Connector's auth was configured (e.g. a custom-header API scheme). `ConnectorMeta` is NOT structurally
credential-safe for agent consumption, despite never carrying the *raw provider secret* value itself.

Both `list_connectors` and both workspace-context surfaces (Decision 5) SHALL therefore serialize a dedicated,
explicit **allow-listed** projection — `ConnectorSummary { id, name, kind, host }` (host = `baseUrl`) — built
by naming exactly those four fields, never by taking `ConnectorMeta`/`ConnectorAuthShape` and subtracting or
substring-scanning for "credential-shaped" keys. `config`/`defaultHeaders`/`authType` are never read into this
projection at all — not redacted, not omitted-if-present, simply never referenced by the serialization code
that builds it. Tests assert the exact key set of the serialized JSON object (`{"id","name","kind","host"}`,
nothing more), not merely the absence of a `credential` key.

## Risks / Trade-offs

- **Breaking change, scoped to the wire boundary**: any EXTERNAL caller posting `{url: ...}` directly to
  `POST /api/sources` for a `rest_api` source will get a 400 after this ships. CORRECTED (was wrong in an
  earlier draft of this doc): this claim does NOT extend to internal service-to-service callers —
  `PipelineProposalService.resolveRestSource` (backend, reachable via `helio-mcp`'s `propose_pipeline`/
  `apply_pipeline_proposal` tools over a PAT) still needs bare-`url` support and keeps it, deliberately, per
  Decision 1's revised edit site (`SourceRoutes`, not `SourceService.createRest`). Mitigated for the actual
  wire-boundary callers by a clear, actionable error message rather than a silent behavior change.
- **Migration/removal conflation risk**: explicitly separated in Decision 1 to avoid the exact mistake the
  coordinator caught — do not let "retire the create path" bleed into "remove the migration."
- **Connector-picker kind mismatch** (frontend, HEL-827 finding): out of scope to fix; will be checked for
  severity during execution/evaluation and reported, not resolved, unless trivially in-scope.
- **Agent-authored-pipeline Connector gap** (surfaced by this ticket, not resolved by it): agents cannot
  create Connectors (Decision 2), so `PipelineProposalService`'s inline bare-`url` REST-source support is
  the only way an agent can currently author a pipeline against a no-auth public API. Converging this onto
  Connector-only source creation needs its own design (a lightweight/ephemeral or agent-visible Connector
  story). Reported to the coordinator for ticket-filing; not filed by this orchestrator.
