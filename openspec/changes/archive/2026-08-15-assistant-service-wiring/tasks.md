## 1. Backend: Non-mutating validate methods (Hard Boundary prerequisite)

- [x] 1.1 Widen `PipelineProposalService.validateStructure` from `private` to `private[services]`
      (mirrors HEL-661's `WorkspaceContextService` visibility-widening precedent)
- [x] 1.2 Add `PipelineProposalService.validate(proposal, user): Future[Either[ServiceError, Unit]]`:
      `validateStructure` check, plus for an existing-`sourceId` reference a read-only
      `dataSourceRepo.findByIdOwned` check; an inline source spec gets structural checks only
      (design.md D3) — no resolution/creation attempted
- [x] 1.3 Add `CombinedProposalService.validate(combined, user): Future[Either[ServiceError, Unit]]`:
      delegates the pipeline portion to `pipelineProposalService.validate`, reuses the existing
      private `validateOutputRefPositions` for the dashboard portion's sentinel-position structure,
      AND mirrors `DashboardProposalService.validateStructure`'s exact two checks — blank
      `combined.dashboard.dashboardName` AND `ProposalPanelSupport.validatePanel` per dashboard
      panel (design.md D3) — only the DB-backed `preValidateBindings` resolution is deferred to real
      apply time, not either pure structural check
- [x] 1.4 Confirm neither new method calls `apply`, `create`, `update`, or `delete` anywhere in its
      call graph (grep the diff before moving on)

## 2. Backend: Protocol types

- [x] 2.1 Add `AssistantProtocol.scala`: `AssistantTurnResult(text: String, proposal:
      Option[AssistantProposal], toolCallCount: Int, hopBudgetExhausted: Boolean, usage: TokenUsage)`
- [x] 2.2 Add sealed `AssistantProposal` (`Dashboard(DashboardProposal)`,
      `Pipeline(PipelineProposal)`, `Combined(CombinedProposal)`, `Patch(PatchSet,
      PatchSetPreviewResponse)`)
- [x] 2.3 Add `AssistantStreamEvent` (sealed: `ToolCallStarted(name, hop)`, `ToolCallFinished(name,
      hop, succeeded: Boolean)`, `Result(text, proposal: Option[AssistantProposal], usage)`,
      `Error(message)`) — protocol type only, no producer/route this ticket (design.md D7)
- [x] 2.4 Add the 4 `propose_*` `ClaudeTool` schema values (`proposeDashboardTool`,
      `proposePipelineTool`, `proposeCombinedTool`, `proposePatchSetTool`) with JSON Schema
      `inputSchema`s matching each underlying proposal type's existing spray-json shape
- [x] 2.5 Add `AssistantProtocol.assistantTools: Vector[ClaudeTool]` = the 6-tool list (design.md
      D2), reusing `WorkspaceAssistantTools.findTool`/`getResourceTool` verbatim

## 3. Backend: AssistantSystemPrompt

- [x] 3.1 Add `AssistantSystemPrompt.scala`: static text covering role ("Helio's dashboard/pipeline
      assistant"), each of the 6 tools and when to use it, the hard 3-hop cap stated explicitly, the
      propose-never-apply boundary, and HEL-401's guardrail wording (budget rejection, no
      fabricated resource ids) carried forward verbatim, not reinvented; the rule "only propose a
      panel kind a fetched DataType's capability menu marks bindable" (design.md D3a)
- [x] 3.2 Ensure the prompt text explicitly nudges toward `propose_pipeline`/`propose_combined` when
      `find` turns up nothing relevant (the mechanism behind AC2's fallback — system prompt only, no
      code branching)
- [x] 3.3 Ensure the prompt text explicitly instructs "call at most one `propose_*` tool per turn"
      (design.md D6 same-hop-concurrency fix)

## 4. Backend: AssistantToolExecutor

- [x] 4.1 Add `AssistantToolExecutor(workspaceSearchService, dashboardProposalService,
      pipelineProposalService, combinedProposalService, patchSetPreviewService, user)` implementing
      `ClaudeToolExecutor.execute(name, input)(implicit ec): Future[Either[String, String]]`
- [x] 4.2 Dispatch `"find"`/`"get_resource"` to `WorkspaceSearchService`, parsing `input` via
      `WorkspaceResourceType.fromString` for `get_resource`'s `type` field AND `find`'s optional
      `resourceTypes` array (an unparseable value is a `Left`, fed back as an error tool_result, not
      an exception)
- [x] 4.2a For `get_resource` when `resourceType == DataType`: additionally call
      `panelCapabilityService.getCapabilities(dataTypeId, user)` and include the resulting
      `PanelCapabilitiesResponse` as a DISTINCT NESTED top-level key in the tool_result payload —
      `{"detail": <WorkspaceResourceDetail JSON>, "panelCapabilities": <PanelCapabilitiesResponse
      JSON>}` — never a flat field union (design.md D3a: both shapes use the literal key `"columns"`
      for different content; a flat merge would silently drop one via `Map ++` right-wins semantics)
- [x] 4.3 Dispatch `"propose_dashboard"`/`"propose_pipeline"`/`"propose_combined"`/
      `"propose_patch_set"`: `input.convertTo[T]` (catch `DeserializationException` → `Left`) →
      the corresponding `validate`/`preview` call → on `Right`, serialize the proposal back as the
      tool_result AND record it via the side channel (design.md D6); on `Left`, feed the error back,
      do not record anything
- [x] 4.4 Implement the one-shot `AtomicReference[Option[AssistantProposal]]` side channel:
      overwritten only on a `propose_*` validation success, read once by `AssistantService.converse`
      after `sendWithTools` returns

## 5. Backend: AssistantService

- [x] 5.1 Add `AssistantService(claudeClient, workspaceSearchService, dashboardProposalService,
      pipelineProposalService, combinedProposalService, patchSetPreviewService)(implicit ec)` in
      `com.helio.services`
- [x] 5.2 Implement `converse(history: Seq[ClaudeToolMessage], message: String, user):
      Future[AssistantTurnResult]` (design.md D1 — explicit history parameter, no `conversationId`
      DB lookup this ticket): appends `message` as a user turn, builds a fresh
      `AssistantToolExecutor` for this call, calls `claudeClient.sendWithTools(ClaudeToolRequest(
      history :+ ClaudeToolMessage.text("user", message), AssistantProtocol.assistantTools, maxHops
      = 3), executor)`, maps `ClaudeToolOutcome` to `AssistantTurnResult` (folding in the side
      channel's captured proposal on `FinalResponse`/`HopBudgetExhausted`)
- [x] 5.3 No DI/route wiring in `ApiRoutes.scala` this ticket (design.md D8)

## Tests

- [x] 6.1 Test: `PipelineProposalService.validate` — structurally valid + existing owned source →
      `Right`; blank/malformed → `Left(BadRequest)`; nonexistent/unowned existing source →
      `Left(NotFound)`; confirm zero pipeline/source/run rows created in every case
- [x] 6.2 Test: `CombinedProposalService.validate` — valid combined proposal → `Right`, zero rows
      created; invalid pipeline portion → `Left`, zero rows created; a structurally invalid
      dashboard panel (blank title, or a chart/aggregation conflict) → `Left`, zero rows created;
      a blank `dashboard.dashboardName` → `Left`, zero rows created (proves BOTH halves of
      `validateStructure`'s mirror actually run, per design.md D3's fix)
- [x] 6.3 Test: `converse` — a scripted `find` → `propose_dashboard` (success) sequence produces
      `AssistantTurnResult(proposal = Some(AssistantProposal.Dashboard(_)))`, fake transport invoked
      exactly twice
- [x] 6.4 Test: `converse` — a scripted `find` (empty) → `propose_pipeline` (success) sequence
      produces `Some(AssistantProposal.Pipeline(_))`, with no `AssistantService` code path
      special-cased on `find`'s emptiness (assert via code review note in the test's own comment,
      not a runtime assertion)
- [x] 6.5 Test: `converse` — a scripted `find`/`get_resource`-only sequence with a final text-only
      response produces `proposal = None`
- [x] 6.6 Test: `converse` — a `propose_dashboard` call whose `input` fails
      `DashboardProposalService.validate` is fed back as an `isError` tool_result and the loop
      continues to a later successful `propose_pipeline`, ending with `Some(AssistantProposal.Pipeline(_))`
      (proves the side channel only records the eventual success, not the earlier rejected attempt)
- [x] 6.7 Test: hard cap — a scripted 4-tool_use-attempt sequence with `maxHops = 3` resolves to the
      `HopBudgetExhausted`-derived `AssistantTurnResult`, fake transport invoked exactly 4 times
      (mirrors HEL-660's own hard-cap fixture style)
- [x] 6.8 Test: the tool list assertion (AC3) — `AssistantProtocol.assistantTools` contains no
      apply-shaped tool name/description
- [x] 6.9 Test: an unparseable `get_resource` `type` argument is fed back as an error tool_result,
      not an exception
- [x] 6.10 Test: zero real network calls anywhere in this suite (fake `ClaudeTransport` throughout,
      same discipline as `ClaudeClientSpec`/`WorkspaceSearchServiceSpec`)
- [x] 6.11 Test: a `get_resource` call for a DataType returns a tool_result payload with `detail` and
      `panelCapabilities` as distinct nested keys, and BOTH sets of `columns` (the DataType detail's
      `semanticRole`-bearing columns AND the capability response's columns) survive intact — not
      just that `panelCapabilities` is present (design.md D3a)
- [x] 6.12 Test: a single hop containing two successful `propose_*` tool_use calls still ends with
      exactly one proposal captured in `AssistantTurnResult.proposal` (asserting *some* proposal is
      present, not which one — design.md D6's documented same-hop race behavior)
