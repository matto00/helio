## 1. Backend — Shared conversation-state generalization (D3/D4)

- [x] 1.1 Add `V78__refinement_conversations.sql`: nullable `latest_patch_set JSONB` column on `authoring_conversations`, plus `CHECK (latest_proposal IS NULL OR latest_patch_set IS NULL)`
- [x] 1.2 Generalize `AuthoringConversationRecord`/`Row`/table mapping to carry `latestPatchSet: Option[PatchSet]` alongside `latestProposal`
- [x] 1.3 Generalize `AuthoringConversationRepository.create`/`appendTurn` to take the dual-optional pair explicitly (never inferred)
- [x] 1.4 Generalize `AuthoringConversationView`/`AuthoringConversationProtocol`/`findDisplayById` to also carry `latestPatchSet`
- [x] 1.5 New `RefinementConversationTurns` (sibling to `AuthoringConversationTurns`): `persistNew`/`persistContinuation` for the patch-set outcome
- [x] 1.6 Generalize `loadForContinuation` (both flows): reject (same "not found" shape as an owner mismatch) a `conversationId` whose loaded record's OWN outcome column (`latestPatchSet` for refinement, `latestProposal` for authoring) is empty — never overwrite the other flow's column (D3a)

## 2. Backend — Refinement service (D1/D2/D5)

- [x] 2.1 New `RefinementTarget`/`RefinementRequest`/`RefinementResponse` protocol types (mirrors `DashboardAuthoringRequest`/`Response`)
- [x] 2.2 New `RefinementGrounding`: dashboard target → `DashboardRepository.findById` + `PanelRepository.findAllByDashboardId(id, Some(user), Page(0, Page.MaxLimit))`; pipeline target → `PipelineService.findSummaryById` + `.listSteps`; BOTH targets also call `WorkspaceContextService.assemble` + `PanelCapabilityService.getCapabilities` per pipeline-output DataType (AC5)
- [x] 2.3 New `RefinementPrompt`: assembles the grounding block (target state + workspace context/capabilities) + a hand-maintained `Edit`/`Update*Request` shape description with a worked JSON example per `target.kind`, including a panel `config` example for EVERY `PanelBindingSpec.DataBindable` kind (metric/chart/table/collection/timeline, all five) — the `PatchSet` analogue of `DashboardAuthoringPrompt.ProposalShapeDescription`
- [x] 2.4 New `RefinementParsing`: parses Claude's response text into a `PatchSet` (mirrors `DashboardAuthoringParsing`)
- [x] 2.5 New `RefinementService`: resolves+ACL-checks target before any Claude call, grounds, calls Claude, parses, validates via `PatchSetPreviewService.preview`, one repair round-trip on rejection, persists via `RefinementConversationTurns`
- [x] 2.6 New `RefinementRoutes`: `POST /api/refinements`, buffered only, gated on `Option[RefinementService]` (`503` when absent), reuses `AuthoringErrorKind`
- [x] 2.7 Wire `RefinementService`/`RefinementRoutes` into `ApiRoutes` alongside the existing `dashboardAuthoringServiceOpt` construction

## 3. Frontend — Refinement chat surface (D6)

- [x] 3.1 New `refinementService.ts`: `POST /api/refinements` client, mirrors `authoringService.ts`
- [x] 3.2 New `useRefinement` hook: buffered (no SSE) request/response state, mirrors `useDashboardAuthoringStream`'s shape minus streaming
- [x] 3.3 New `RefinementChatDrawer.tsx` + `.css`: sibling to `AuthoringChatDrawer`, required `dashboardId` prop, same thread/error/reset UX
- [x] 3.4 "Review & apply" navigates to `/patch-sets/review` with `location.state.patchSet`
- [x] 3.5 Reload-hydration via `GET /api/authoring/conversations/:id`'s generalized `latestPatchSet`, mirrors `rehydrateFromStorage`
- [x] 3.6 Mount `RefinementChatDrawer` + a "Refine with AI" trigger in `App.tsx`, gated on `selectedDashboardId !== null`

## 4. MCP — propose/apply patch-set tools (D7)

- [x] 4.1 `HelioApi.proposePatchSet` (calls `POST /api/refinements`) and `HelioApi.applyPatchSet` (calls existing `POST /api/patch-sets/apply`)
- [x] 4.2 New `helio-mcp/src/tools/refinement.ts`: `propose_patch_set` + `apply_patch_set` tool definitions, descriptions matching `proposal.ts`'s tone
- [x] 4.3 Register both tools in the MCP server entrypoint; update `helio-mcp/README.md`

## 5. Tests — Backend

- [x] 5.1 `RefinementServiceSpec` (mocked Claude): dashboard grounding, pipeline grounding, preview-reuse validation, repair-once-then-422, target ACL rejection before any Claude call, an authoring `conversationId` passed to refinement continuation is rejected (not silently reassigned)
- [x] 5.2 `AuthoringConversationRepositorySpec` additions: `latest_patch_set` persists/reads correctly; DB `CHECK` rejects a write populating both columns; mutual exclusivity (an authoring conversation's `latest_patch_set` stays `NULL`, and vice versa)
- [x] 5.3 `RefinementRoutesSpec`: `503` when unconfigured, request/response shape, conversationId continuation
- [x] 5.4 `DashboardAuthoringServiceSpec` addition (mirrors 5.1's cross-flow test, beside its existing "owned by a different user" case): a refinement `conversationId` passed to `POST /api/authoring/dashboard` continuation is rejected (not silently reassigned)

## 6. Tests — Frontend + MCP

- [x] 6.1 `RefinementChatDrawer.test.tsx`: submit flow, thread rendering, Review & apply hand-off, reload rehydration
- [x] 6.2 `useRefinement`/`refinementService` unit tests
- [x] 6.3 `refinement.test.ts` (MCP): `propose_patch_set` returns without writing; `apply_patch_set` posts to the existing apply endpoint

## 7. Verification

- [x] 7.1 `sbt test` + `npm test` + `npm run lint`/`format:check` + `npm run check:schemas`/`check:openspec` all green
