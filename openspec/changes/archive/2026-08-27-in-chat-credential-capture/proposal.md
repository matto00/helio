## Why

HEL-820's Connectors epic is complete except for the seam where an AI-authored proposal
(pipeline / dashboard / combined) needs a REST API the workspace has no Connector for yet.
Today `POST /api/sources` (and proposal-apply, which routes through the same path) hard-requires
`connectorId` — a bare `url` is rejected. The assistant is prompted to call `list_connectors` and
reference an existing one, but nothing stops it proposing a `connectorId` for a Connector that
doesn't exist, and nothing lets it express "this step needs a **new** Connector" at all. Today
that surfaces only as an opaque failure deep inside `SourceService` when the proposal is applied.

Per design (and HEL-828's non-goal): the agent must never see or create a credential — there is
no `create_connector` MCP tool, by design. So when a proposal needs a Connector that doesn't
exist, a human has to supply the secret, and it must go straight from their keyboard to
`POST /api/connectors`, never through the model.

## What Changes

- **Proposal schema**: `PipelineProposalSource.restConfig` changes type to a NEW, proposal-only
  `ProposalRestApiConfig` (decoded by `PipelineProposalProtocol`'s own hand-written reader — never
  the live `RestApiConfigPayload`/`CreateSourceRequest`/`DataSourceConfigCodec` type, which stays
  completely untouched) carrying `connectorId` (existing), the legacy `url` (unchanged, still
  dual-supported end-to-end via `SourceService.createRest`'s implicit-Connector synthesis), or a
  new `newConnector` draft (name, baseUrl, authType, apiKeyName/placement,
  `retrievalInstructions`) — authored by the model when `list_connectors` found nothing suitable.
  `NewConnectorDraft` carries no secret field; the model supplies instructions for where a human
  finds the key, never the key itself. Exactly one of the three is required.
- **Proposal-generation prompting** (`AssistantProposalToolSchemas`): documents the new
  `newConnector` branch and when to use it.
- **Proposal-review UI**: `PipelineProposalReview`, `CombinedProposalReview`, and
  `ProposalReview` (dashboard) scan the proposal for REST steps with an unresolved
  `newConnector`/nonexistent `connectorId` and render an inline **"Set up connector"** section per
  missing Connector — reusing `ConnectorCredentialField` (HEL-824) verbatim. The section shows the
  model-authored retrieval instructions and an explicit "agents never see this key" statement, and
  submits directly to the existing `createConnector` Redux thunk (`POST /api/connectors`) — never
  through proposal state, assistant state, or any thunk that touches conversation data. On success
  the returned `connectorId` is spliced into the reviewer's local copy of the proposal only; "Apply
  proposal" stays disabled until every referenced Connector is resolved.
  - `dashboard`-kind proposals reference only existing pipeline-produced DataTypes (no source/
    connector data ever appears on that type) — the missing-connector section is structurally
    absent for that kind, which satisfies the "works for pipeline, dashboard, combined" AC
    vacuously for `dashboard` and concretely for `pipeline`/`combined` (via `combined.pipeline`).
- **Mechanical, demonstrated-red enforcement** (the AC's hard requirement): a new lint check
  (mirroring `check-scala-quality.mjs`'s existing text/AST-pattern approach) scans the
  assistant/proposal-persistence surface for any import of the credential-carrying value outside
  an explicit allow-list (`ConnectorCredentialField`, `connectorsSlice`, the new setup component),
  wired into `npm run lint` / Husky. A companion unit test constructs the actual
  conversation-persistence payload after a `newConnector`-round-trip and asserts the raw
  credential string is absent by direct string search — plus a deliberately-violating fixture
  proving the lint check fails red before being reverted.
- **Backend surface enumeration**: confirms (and adds a regression test asserting) that no
  backend service under `services/assistant`, `services/ai`, or `helio-mcp/src` ever references a
  credential field — the design keeps the credential entirely client → `POST /api/connectors`,
  with no backend code path for it to reach assistant machinery at all.

## Non-Goals (deliberately out of scope, confirmed by research)

- The legacy bare-`url` inline-source path is unchanged — still out of scope (HEL-822).
- SQL sources' raw `password` MCP-tool field is unchanged (SQL sources are not Connector-only yet).
- No MCP tool is added for Connector creation — none exists today and none is added now.
- The Connector picker's unfiltered-kind-list defect and HEL-843/HEL-844 are explicitly not
  addressed here (separately tracked).

## Impact

- Affected specs: `assistant-proposal-authoring` (or nearest existing capability spec covering
  pipeline-proposal generation), `connectors` (proposal-review UI addition).
- Affected code: `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProposalProtocol.scala`,
  `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`,
  `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala`,
  `frontend/src/features/pipelines/ui/proposalReview/*`, `frontend/src/features/proposals/ui/CombinedProposalReview.tsx`,
  `frontend/src/features/dashboards/ui/ProposalReview.tsx`, `frontend/src/features/connectors/**`,
  a new lint script under `scripts/`.
