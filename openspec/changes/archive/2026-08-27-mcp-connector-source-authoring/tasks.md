## 1. Backend — retire bare-url ONLY at the wire boundary (SourceRoutes), keep internal callers untouched

REVISED mid-execution (coordinator correction) — `SourceService.createRest` is REVERTED to its original
bare-`url` behavior; the rejection moves to `SourceRoutes` instead. See design.md Decision 1.

- [x] 1.1 REVERT any change already made to `SourceService.createRest`'s `(None, Some(url))` match arm —
      it must synthesize an implicit no-auth Connector exactly as it did before this ticket, so
      `PipelineProposalService.resolveRestSource` keeps working unmodified.
- [x] 1.1a In `SourceRoutes` (`POST /api/sources`'s HTTP shell), before dispatching to
      `sourceService.createRest`, reject a `rest_api`-typed body whose `config` carries `url` but no
      `connectorId` with 400, naming `connectorId` explicitly and directing the caller to create a
      Connector first. Decode (`CreateSourceRequest.convertTo`/`RestApiConfigPayload`'s own decoder) stays
      completely total and unmodified — this is a create-time check at the route, not a decode-path
      rejection. `RestApiConfigPayload.toDomain` is NOT touched — its own `(None, Some(_))` branch remains
      dead code on the `createRest` path (verify with a grep/read before editing, don't assume).
- [x] 1.2 Confirm untouched, explicitly, by grep/diff review before committing: `RestSourceConnectorMigration`,
      `ImplicitConnectorConfig`, `SourceService.createRest` (reverted to original per 1.1),
      `SourceService.inferRest`, `SourceService.testRest`, `PipelineService.resolveInlineSourceSchema`'s own
      ephemeral `(None, Some(url))` branch, and `PipelineProposalService.resolveRestSource`. No edits to
      any of these seven.
- [x] 1.3 Update/add backend tests: a bare-url `POST /api/sources` request → 400 with actionable message
      naming `connectorId` (route-level test); connectorId create still 201; body-on-GET still 400;
      infer/test-connection ephemeral bare-url paths still succeed unchanged; migration's own test suite
      still green untouched; the 3 `PipelineApplyProposalRollbackSpec` inline-bare-url tests MUST remain
      untouched and green — if they need editing, the fix is in the wrong place.

## 2. Backend — slim credential-safe Connector projection + workspace context (both surfaces)

- [x] 2.1 Define a dedicated `ConnectorSummary { id, name, kind, host }` wire type (host = `baseUrl`),
      built by naming exactly those four fields from the domain `Connector` — never by projecting
      `ConnectorMeta`/`ConnectorAuthShape` and subtracting/substring-scanning for credential-shaped keys.
      `config`/`defaultHeaders`/`authType` are never referenced by this serialization at all.
- [x] 2.2 Add `connectors: Vector[ConnectorSummary]` to `WorkspaceContextResponse`, owner-scoped via
      `ConnectorEntityService`'s existing list query, serialized through 2.1's projection only.
- [x] 2.3 Add a test asserting the exact serialized key set of one `connectors` entry is
      `{"id","name","kind","host"}` — nothing more — not merely "no key literally named credential".
      Include a fixture Connector whose `defaultHeaders` contains an `Authorization`-shaped value, to prove
      it is dropped by construction, not filtered.
- [x] 2.4 Confirm budget-trimming behavior doesn't silently drop the new field ahead of existing priority
      order (see spec scenario) — add or extend a trimming test if the existing suite has a natural slot.
- [x] 2.5 `helio-mcp/src/context.ts` (the client-side fan-out that actually backs the `get_workspace_context`
      MCP tool / `helio://workspace/context` resource — confirmed distinct from `WorkspaceContextResponse`,
      it never reads that backend type) gains its own additional fan-out call to `GET /api/connectors`
      (via `helioApi.ts`), serializing the same id/name/kind/host projection into the returned context
      object. This is the surface MCP agents actually receive — required for the AC, not optional.
- [x] 2.6 The `connectors` field on `WorkspaceContextResponse` is a structural field for budget-trimming
      purposes — never shrunk/omitted under `budgetBytes` pressure (spec: "Connectors are a structural
      field, never shrunk by budget trimming"). Add a test alongside the existing tightest-budget test.
- [x] 2.7 `helio-mcp/src/context.ts`'s new connectors fan-out call degrades to an empty `connectors: []`
      list on failure, mirroring the existing sibling degrade-that-section-only pattern for
      preferences/memory — a failed `GET /api/connectors` call must never fail the whole
      `get_workspace_context` call. Add a test alongside the existing preferences/memory degradation test.

## 3. helio-mcp — list_connectors tool

- [x] 3.1 Add a `listConnectors()`-equivalent to `helio-mcp/src/helioApi.ts` calling `GET /api/connectors`,
      mapping the backend's slim `ConnectorSummary` (task 2.1) shape — never the full `ConnectorMeta` wire
      shape — into a matching TS type.
- [x] 3.2 Register `list_connectors` tool in `helio-mcp/src/tools/read.ts`, returning id/name/kind/host only.
      Description states plainly that credentials are never returned.
- [x] 3.3 Add a `ConnectorSummary` type to `helio-mcp/src/types.ts` mirroring the backend's — exactly
      `id`/`name`/`kind`/`host`, no `config`/`defaultHeaders` field present on the TS type at all (so there
      is nothing for a serialization bug to leak even if the backend response shape ever changed).

## 4. helio-mcp — create_rest_data_source against a Connector

- [x] 4.1 Rewrite `create_rest_data_source`'s Zod input schema in `write.ts`: drop `url`/`auth`, add
      required `connectorId`, optional `endpoint`/`queryParams`/`body`/`bodyContentType`/`rootSelector`;
      keep `method`/`headers`.
- [x] 4.2 Update `helioApi.ts`'s `createRestDataSource` wrapper and `types.ts`'s request/response shapes to
      match (drop `RestAuthInput`/`url` usage for this tool's call site).
- [x] 4.3 Update the tool description: explicit connectorId-first framing, state credentials are never
      returned, no url/auth accepted.
- [x] 4.4 Add a hostile-input test/manual check: attempt to call `create_rest_data_source` with an extra
      `auth`/`apiKey`/`token` field — demonstrate it's dropped/rejected by the schema, not merely documented
      as forbidden.

## 5. Verify (not modify) the in-app assistant surface

- [x] 5.1 Re-read `AssistantProposalToolSchemas.scala`/`AssistantToolExecutor.scala` for the current
      `connectorId`-shaped rest_api config and its `test_connection` handling; confirm they compile clean
      against this change (bare-url create removal, Decision 1) and remain internally consistent with the
      MCP tool's new shape. Report any divergence found — do not expand scope to fix it.

## 6. End-to-end demonstration (acceptance criterion, not a unit test)

- [x] 6.1 Real run: create a Connector (via API/UI in the running dev stack), call `list_connectors` via the
      MCP server, call `create_rest_data_source` with the returned `connectorId`, confirm the source
      successfully fetches (DataType created, no fetchError). Capture the transcript/output as evidence.

## 7. Credential-never-reaches-the-surface enumeration (acceptance criterion)

- [x] 7.1 Enumerate every MCP tool result and workspace-context payload that could carry Connector data
      (list_connectors, create_rest_data_source result, get_workspace_context/connectors block, any other
      tool touching sources/connectors) and verify none contain a credential field, checked in both
      directions (schema-level: no such field exists; runtime: hostile-input attempt is rejected/dropped).
      Record the enumeration in the evaluator/skeptic evidence, not just asserted in a commit message.

## 8. Confirm (do not fix) the Connector-picker kind-mismatch finding

- [x] 8.1 Select a mismatched-kind Connector (e.g. a SQL Connector) in the REST source picker in the running
      dev UI; observe and record whether the failure is a clear, graceful error or a confusing/corrupt
      outcome. Report the finding; do not fix unless it falls naturally within this ticket's diff.
