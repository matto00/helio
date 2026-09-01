## Skeptic Report — final gate, dimension: wire-contract diff (round 1, skeptic-final-4-wire-contract.md)

Scope: ONLY the wire-shape/contract dimension. Other dimensions covered by the three sibling
final-gate skeptics. Every claim below is derived from the actual backend route/protocol files and
the actual merged TS, not from ticket/design prose.

### What I verified (with evidence)

1. **`POST /api/pipelines/:id/preview?outputId=` — identical envelope in both arms (design.md D3).**
   CONFIRMED. Route: `PipelineRunStatusRoutes.scala:53-56` → `PipelineRunService.previewOutputs`.
   Both arms return `PipelinePreviewResponse(outputs: Vector[OutputPreviewEntry])`
   (`PipelineRunService.scala:296` single-Output arm, `:311` all-Outputs arm;
   `PipelineProtocol.scala:160/166`). MCP `helioApi.ts:866` passes `outputId` through with no
   branching and types it `PipelinePreviewResponse` (`types.ts:242-247`) — field-for-field match.

2. **`list_outputs` scoped-vs-unscoped route choice (round-3 design-gate correction).** CONFIRMED
   landed in code. `outputsHandlers.ts:65-71`: `input.pipelineId ? listOutputsByPipeline(id, nodeStepId)
   : listAllOutputs(limit, offset)`. `helioApi.ts:814` → `GET /api/pipelines/:id/outputs?nodeStepId=`
   (backend `OutputRoutes.scala:31-40`, returns `OutputsResponse{items}`); `helioApi.ts:820` →
   `GET /api/outputs` (backend `OutputRoutes.scala:109-120`, returns `PagedResult{items,total,offset,limit}`).
   TS `OutputsResponse{items}` / `Paged<T>{items,total,offset,limit}` match exactly. `nodeStepId` is
   only passed on the scoped arm, matching the spec's "only meaningful alongside pipelineId".

3. **`GET /api/outputs/:id/rows`, `/assertion-status`, `GET /api/pipelines/:id/capabilities?stepId=`,
   `POST /api/pipelines/:id/validate-expression?stepId=`.** All four routes exist as claimed
   (`OutputRoutes.scala:80,88`; `PipelineRoutes.scala:59,68`). Response shapes match the MCP types
   field-for-field: `PagedResult[JsValue]` vs `Paged<Record<string,unknown>>`;
   `AssertionStatusResponse(outputId, invalid, failedRuleCount)` (PipelineProtocol.scala:114) vs
   types.ts:230-234; `NodeCapabilitiesResponse(stepId: Option, columns, capabilities: Map)`
   (NodeCapabilitiesProtocol.scala:15-23) vs types.ts:166-170, with `PanelCapabilityResponse`'s six
   fields (bindable/requiredSlots/optionalSlots/eligibleColumns/reason?/message?) matching
   PanelCapabilityProtocol.scala:38-45. `validate-expression` has no MCP caller — no mismatch possible.

4. **`create_pipeline` two-call inline-source composition (design.md D2).** CONFIRMED.
   `pipelinesHandlers.ts:63-113` `resolveSource` issues `POST /api/data-sources` (static/rest/sql via
   `helioApi.ts:347/383`) and returns `createdSourceId`; `:127-150` then calls
   `POST /api/pipelines` with it as `sourceDataSourceId`, and on failure throws an error whose text
   embeds `orphaned DataSource id: ${createdSourceId}` — not swallowed. Request body matches
   `CreatePipelineRequest(name, sourceDataSourceId, tag?, steps, outputs)` including
   `CreatePipelineTransactionalStepRequest(clientId, type, config, parentStepId?, enabled?)` and
   `CreatePipelineTransactionalOutputRequest(nodeStepClientId?, kind, name, config?)`
   (PipelineProtocol.scala:23-42) vs `PipelineProposalStep`/`PipelineProposalOutput`
   (types.ts:696-713). Backend's hand-rolled reader defaults absent `steps`/`outputs` to empty, so
   the MCP's omit-when-undefined body is safe.

5. **Cycle-14 bug class — the two known instances are genuinely fixed, no third found in-code.**
   `expandPipelineShape` (`helioApi.ts:524-531`) now types the body as `ExpandPipelineShapeResponse`
   and returns `response.steps`, matching `ExpandPipelineShapeResponse(steps, outputs: Option[JsArray])`
   (PipelineShapeProtocol.scala:88). `deletePipelineStep` (`helioApi.ts:999-1006`) reads and surfaces
   `removedTailStepCount` from the 200 body, matching `DeletePipelineStepResponse(removedTailStepCount: Int)`
   (PipelineStepProtocol.scala:186). Both traced against the route/protocol, not against test mocks.

6. **spray-json Option-omission discipline.** `grep '=== null'` across `helio-mcp/src/**` (non-test)
   returns exactly one hit, in `httpClient.ts:220` on an HTTP *header* (not a JSON body) — no wire
   optional is compared to `null`. Optional wire fields are read with the absence-safe `?? null`
   idiom (`context.ts:200` nodeStepId, `:446/:502` tag) and typed optional (`nodeStepId?`, `stepId?`,
   `reason?`, `message?`, `outputs?`, `parentStepId?`).

7. **Panel placement wire shapes.** `place_outputs` posts `{dashboardId, panels:[{title,type:"output",
   config:{outputId}}]}` to `POST /api/panels/batch` — route exists (`PanelRoutes.scala:42-45`),
   `CreatePanelsBatchRequest(dashboardId, panels: Vector[CreatePanelBatchItem(title,type,config,appearance)])`
   matches, `"output"` is a valid `PanelType` (model.scala:137) and `OutputPanelConfig(outputId)`
   (OutputPanel.scala:18) matches the config. Response `{panels}` is order-preserving
   (`PanelService.batchCreate:320-329` is a positional `map`), which `placementsHandlers.ts:44-50`'s
   index-pairing depends on. `POST /api/dashboards/:id/auto-layout` exists (AutoLayoutRoutes.scala:30).
   `create_content_panel`'s four types all parse (model.scala:132-137).

8. **Pagination clamp.** Both `fetchAllOutputs` (context.ts:156) and the new frontend
   `outputsService.fetchOutputs` page with `limit = 200` ≤ `Page.MaxLimit = 500`
   (pagination.scala:12), so no silent skipping from a server-side clamp.

9. **Gates re-run by me, fresh.** `node scripts/check-schema-drift.mjs` → exit 0, "73 checked across
   48 protocol files". Scoped helio-mcp jest (ticket.md's verified command, `/dist/` excluded) →
   18 suites / 182 tests passed, 3.0s, no OOM.

### Verdict: REFUTE

One defect found, and it is exactly this dimension's failure class: a response field added to the
wire in cycle 17/20 without the matching response schema update. It is the only one — items 1-9
above are clean.

### Change Requests

1. `schemas/dashboards/dashboard.schema.json` does not agree with the new wire shape.
   `DashboardResponse` gained `tag: Option[String]` this cycle
   (`backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala:33-38`,
   emitted by `DashboardResponse.fromDomain:113`, serialized by `jsonFormat7`), so
   `GET/POST /api/dashboards` now emits a `tag` key whenever a dashboard was created with one.
   The response schema still declares only `["id","name","meta","appearance","layout","ownerId"]`
   with `"additionalProperties": false` (`schemas/dashboards/dashboard.schema.json:6-31`) — i.e. the
   declared contract *forbids* the field the backend now sends. The ticket correctly updated the two
   sibling schemas (`create-dashboard-request.schema.json` gained `tag`,
   `workspace-teardown-response.schema.json` gained `dashboardsDeleted`) and missed this one.
   `scripts/check-schema-drift.mjs` cannot catch it: `"Dashboard"` is in that script's `SKIP` set
   (check-schema-drift.mjs:90-91), so the green drift gate is not evidence here.
   Fix: add a `tag` property to `schemas/dashboards/dashboard.schema.json` (`"type": "string"`,
   `minLength: 1`, `maxLength: 200`, left out of `required` because spray-json omits an unset
   `Option` entirely rather than emitting `null` — the same wording the other schemas in this repo
   already use for absent-not-null Option fields).

### Non-blocking notes

- `addOutputsFromShapeHandler` (`helio-mcp/src/tools/pipelinesHandlers.ts:176-194`) ignores each
  expansion's own `parentStepId`/`clientId` and re-derives a linear chain client-side. That is
  correct today — `PipelineShapeProtocol.scala:62-65` states every shape expands to a pure linear
  chain — but it will silently flatten the first genuinely branching shape. Worth a comment or a
  follow-up when branching shapes land (P2.4).
- The backend's own `/api/workspace/context` still names its Outputs section `dataTypes`
  (`WorkspaceContextProtocol.scala:19`, `WorkspaceContextService.scala:139-159`) even though the
  entries are now `WorkspaceContextOutput`s. Schema and protocol agree with each other, so this is
  not drift — just a stale name on the in-app assistant's wire, outside this ticket's MCP surface.
