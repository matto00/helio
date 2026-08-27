# Files modified — HEL-828

## Backend

- `backend/src/main/scala/com/helio/api/routes/sources/SourceRoutes.scala` — retires bare-`url`
  `rest_api` create acceptance at the `POST /api/sources` HTTP wire boundary (design.md Decision 1,
  revised mid-execution): rejects a request whose `config` carries `url` but no `connectorId` with
  400, naming `connectorId` explicitly. `SourceService.createRest` itself is UNTOUCHED (reverted after
  an initial edit — see escalation below).
- `backend/src/main/scala/com/helio/api/protocols/sources/ConnectorEntityProtocol.scala` — adds the
  slim, explicitly allow-listed `ConnectorSummary { id, name, kind, host }` wire type + its
  `RootJsonFormat`, built by naming exactly those four fields off the domain `Connector`.
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` — adds
  `connectors: Vector[ConnectorSummary]` to `WorkspaceContextResponse`; mixes in
  `ConnectorEntityProtocol` for the formatter.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — adds
  `connectorRepoOpt: Option[ConnectorRepository] = None` (trailing, default-`None`, mirrors
  `panelRepoOpt`'s precedent) and `buildConnectors`, wired into `assemble`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires the existing `connectorRepoOpt` into
  the `WorkspaceContextService` construction.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — updates the two `POST /api/sources`
  rest_api create tests to use a real `connectorId` (bare-url create no longer succeeds at the wire
  boundary); adds a bare-url-rejected-400 test.
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — same connectorId
  update for its one persisting-create `rest_api` test; adds a bare-url-rejected-400 test.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpecBase.scala` — adds a
  `connectorRepo` field so subclasses can seed a real Connector.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalRollbackSpec.scala` —
  `createRestSource`'s helper now seeds a Connector via `connectorRepo` and posts `connectorId` instead
  of a bare `url` (this helper hits `POST /api/sources` directly, unlike the three inline-source
  apply-proposal tests, which are deliberately left untouched — see escalation below).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — adds a
  `serviceWithConnectors` instance + a `connectors` test group: exact key-set assertion, a
  credential-shaped `defaultHeaders` fixture proving it's dropped by construction, owner-scoping, and
  the not-wired-degrades-to-empty case.
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceApplyBudgetSpec.scala` —
  adds `connectors` to the response fixture + a "never shrunk, even at the tightest budget" test.

## helio-mcp

- `helio-mcp/src/types.ts` — adds `ConnectorSummary { id, name, kind, host }` (no `config`/
  `defaultHeaders` field on the TS type at all); removes the now-dead `RestAuthInput` type (round 1
  of final-gate skeptic review — its only reference was its own declaration once
  `createRestDataSource` stopped accepting `auth`).
- `helio-mcp/src/helioApi.ts` — adds `listConnectorInstances()` (named distinctly from the pre-existing
  `listConnectors()`, which lists connector-KIND metadata via `/api/connector-types` — see naming note
  below) calling `GET /api/connectors`, mapping into `ConnectorSummary[]`; rewrites
  `createRestDataSource` to accept `connectorId` + REST-shaping fields instead of `url`/`auth`.
- `helio-mcp/src/tools/read.ts` — registers the new `list_connectors` MCP tool.
- `helio-mcp/src/tools/restDataSourceSchema.ts` (new) — extracts `create_rest_data_source`'s Zod
  schema into its own module (mirrors `metricSchemas.ts`'s existing extraction precedent), so it's
  independently unit-testable without pulling `write.ts`'s full ~20-tool Zod surface into the ts-jest
  compile graph. `auth`/`apiKey`/`token`/`password`/`credential` are explicit, always-rejecting fields
  with a connectorId-naming error message; the built schema is additionally `.strict()` (round 1 of
  final-gate skeptic review) so any OTHER unrecognized key — including a bare `url` — is also rejected,
  not silently dropped.
- `helio-mcp/src/tools/restDataSourceSchema.test.ts` (new) — hostile-input coverage: the 5 named
  credential-shaped fields, an unlisted one (`secret`, proving `.strict()` closes the gap), and a bare
  `url` are all LOUDLY rejected (a failed parse naming `connectorId`), not silently stripped.
- `helio-mcp/src/tools/write.ts` — `create_rest_data_source` now registers the built (`.strict()`)
  schema object, not the raw shape; updated tool description.
- `helio-mcp/src/context.ts` — adds `buildConnectors` (its own independently try/catch-guarded fan-out
  call to `GET /api/connectors`, mirroring `buildAgentContext`'s precedent) and a `connectors` field on
  `WorkspaceContext`.
- `helio-mcp/src/context.test.ts` — adds a `connectors wiring` test group (populate, degrade-on-reject,
  degrade-when-method-missing, empty-list-not-error) + `connectors: []` on the two hand-built
  `WorkspaceContext` fixtures the pre-existing `applyBudget` tests use.

## Schema

- `schemas/workspace/workspace-context.schema.json` — adds `connectors` (required) +
  `$defs/ConnectorSummary` (`id`/`name`/`kind`/`host`, `additionalProperties: false`).

## OpenSpec

- `openspec/changes/mcp-connector-source-authoring/tasks.md` — all tasks marked complete; task
  1/1.1/1.1a/1.2/1.3 rewritten mid-execution per the escalation resolution below.
- `openspec/changes/mcp-connector-source-authoring/design.md` — Decision 1 rewritten by the
  orchestrator during the escalation (see below); Decision 4's overclaiming prose corrected for
  `.strict()` in round 1 of final-gate skeptic review (see below).
- `openspec/changes/mcp-connector-source-authoring/e2e-evidence.md` (new) — real, transcript-backed
  evidence for tasks 6.1 (MCP-server end-to-end run, driven over stdio via a real SDK client)/7.1
  (credential-enumeration table)/5.1/8.1 (findings), added in response to evaluation-1.md's Phase 1
  finding that these tasks were checked done with no supporting evidence in the change directory;
  extended in round 1 of final-gate skeptic review with the `.strict()` live-verification transcript.

## Escalation (resolved mid-execution)

Task 1.1's original plan (retire bare-`url` inside `SourceService.createRest` itself) turned out to
break a real caller: `PipelineProposalService.resolveRestSource` (the `POST /api/pipelines/
apply-proposal` inline-source path, reachable via the MCP `propose_pipeline`/`apply_pipeline_proposal`
tools) also calls `SourceService.createRest` with a bare `url`. The orchestrator resolved this by
moving the rejection to the `SourceRoutes` HTTP wire boundary instead, reverting `SourceService.
createRest` to its original synthesizing behavior. `PipelineApplyProposalRollbackSpec`'s three
inline-bare-url tests remain **completely untouched** — proof the fix landed at the correct boundary,
per the resolution's own acceptance criterion.
