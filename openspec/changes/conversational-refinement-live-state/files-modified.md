## Backend

- `backend/src/main/resources/db/migration/V78__refinement_conversations.sql` — adds nullable `latest_patch_set JSONB` to `authoring_conversations` + the mutual-exclusivity `CHECK` (design.md D3)
- `backend/src/main/scala/com/helio/api/protocols/RefinementProtocol.scala` — new: `RefinementTarget`/`RefinementRequest`/`RefinementResponse` wire types + formats
- `backend/src/main/scala/com/helio/api/protocols/AuthoringConversationProtocol.scala` — generalized `AuthoringConversationView` to carry `latestPatchSet`; mixes in `PatchSetProtocol`
- `backend/src/main/scala/com/helio/infrastructure/AuthoringConversationRepository.scala` — generalized `AuthoringConversationRecord`/`Row`/table + `create`/`appendTurn`/`findDisplayById` to carry both `latestProposal` and `latestPatchSet` as explicit dual-optional params (design.md D3)
- `backend/src/main/scala/com/helio/services/AuthoringConversationTurns.scala` — updated call sites for the generalized repository signatures (always passes `latestPatchSet = None`)
- `backend/src/main/scala/com/helio/services/RefinementConversationTurns.scala` — new: sibling turn-persistence glue for the refinement flow (always passes `latestProposal = None`)
- `backend/src/main/scala/com/helio/services/RefinementGrounding.scala` — new: fetches a refinement target's real live state (dashboard panels / pipeline steps) + workspace context/capabilities; doubles as target resolve+ACL check
- `backend/src/main/scala/com/helio/services/RefinementEditShape.scala` — new: hand-maintained `PatchSet`/`Edit` shape description + worked JSON examples (D2a) — split out from `RefinementPrompt` for file-size budget
- `backend/src/main/scala/com/helio/services/RefinementPrompt.scala` — new: builds the Claude prompt (instructions + grounding block + repair message)
- `backend/src/main/scala/com/helio/services/RefinementParsing.scala` — new: parses Claude's text response into a `PatchSet`, reusing `DashboardAuthoringParsing.extractJsonObject`
- `backend/src/main/scala/com/helio/services/RefinementService.scala` — new: orchestrates ground → prompt → Claude → parse → `PatchSetPreviewService.preview` → repair-once → persist
- `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala` — `getConversation`/`loadForContinuation` generalized (D3a): rejects a cross-flow `conversationId` (refinement conversation passed to authoring continuation) the same "not found" shape
- `backend/src/main/scala/com/helio/api/routes/RefinementRoutes.scala` — new: `POST /api/refinements` HTTP shell, buffered only, `503` when unconfigured
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `RefinementGrounding`/`RefinementService`/`RefinementRoutes` alongside the existing authoring wiring
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes in `RefinementProtocol`; doc-comment update
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports `RefinementTarget`/`RefinementRequest`/`RefinementResponse` into `com.helio.api`

## Backend tests

- `backend/src/test/scala/com/helio/services/RefinementServiceSpec.scala` — new: dashboard/pipeline grounding, repair-once-then-422, target ACL rejection, multi-turn continuation, D3a cross-flow rejection
- `backend/src/test/scala/com/helio/api/routes/RefinementRoutesSpec.scala` — new: 200 shape, 503 when unconfigured, conversationId continuation, 404 for missing target
- `backend/src/test/scala/com/helio/infrastructure/AuthoringConversationRepositorySpec.scala` — additions: `latest_patch_set` round-trip, mutual-exclusivity per flow, DB `CHECK` rejects a both-populated write; existing fixtures/calls updated for the new dual-optional signature
- `backend/src/test/scala/com/helio/services/DashboardAuthoringServiceSpec.scala` — addition: a refinement `conversationId` passed to authoring continuation is rejected (D3a symmetric counterpart); fixture updated for the new record field

## Frontend

- `frontend/src/features/dashboards/types/refinement.ts` — new: `RefinementTarget`/`RefinementRequest`/`RefinementResult` types
- `frontend/src/features/dashboards/types/authoring.ts` — `AuthoringConversationView` generalized with `latestPatchSet`
- `frontend/src/features/dashboards/services/refinementService.ts` — new: `POST /api/refinements` client + `RefinementRequestError`
- `frontend/src/features/dashboards/hooks/useRefinement.ts` — new: buffered request/response state hook
- `frontend/src/features/dashboards/utils/refinementSummary.ts` — new: deterministic patch-set summary text (mirrors backend `RefinementConversationTurns.summaryFor` byte-for-byte)
- `frontend/src/features/dashboards/ui/RefinementChatDrawer.tsx` + `.css` — new: sibling drawer to `AuthoringChatDrawer`, required `dashboardId` prop
- `frontend/src/app/App.tsx` — mounts `RefinementChatDrawer` + "Refine with AI" trigger, gated on `selectedDashboardId !== null`

## Frontend tests

- `frontend/src/features/dashboards/services/refinementService.test.ts` — new
- `frontend/src/features/dashboards/hooks/useRefinement.test.ts` — new
- `frontend/src/features/dashboards/ui/RefinementChatDrawer.test.tsx` — new: submit flow, thread rendering, Review & apply hand-off, reload rehydration, dashboard-switch reset

## MCP (helio-mcp)

- `helio-mcp/src/types.ts` — new `PatchSet`/`Edit`/`EditTarget`/`EditOutcome`/`PatchSetApplyResponse`/`RefinementResult` type mirrors
- `helio-mcp/src/helioApi.ts` — new `proposePatchSet`/`applyPatchSet` methods
- `helio-mcp/src/tools/refinementHandlers.ts` — new: plain call-routing functions (no zod/`McpServer` import, avoids the documented ts-jest TS2589 issue)
- `helio-mcp/src/tools/refinement.ts` — new: `propose_patch_set`/`apply_patch_set` tool registration (zod schemas), delegates to the handlers
- `helio-mcp/src/index.ts` — registers `registerRefinementTools`
- `helio-mcp/README.md` — documents the two new tools

## MCP tests

- `helio-mcp/src/tools/refinementHandlers.test.ts` — new: call-routing coverage (propose writes nothing, apply posts to the existing endpoint, error propagation)

## Schemas

- `schemas/authoring-conversation.schema.json` — adds `latestPatchSet` (`$ref` patch-set.schema.json)
- `schemas/refinement-request.schema.json` — new
- `schemas/refinement-response.schema.json` — new
