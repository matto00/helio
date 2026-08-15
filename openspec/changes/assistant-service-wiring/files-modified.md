# Files modified — HEL-662 assistant-service-wiring

- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` — widened
  `validateStructure` to `private[services]`; added non-mutating `validate(proposal, user)`
  (structural check + read-only existing-`sourceId` ownership check via `dataSourceRepo`), required
  by the Hard Boundary.
- `backend/src/main/scala/com/helio/services/CombinedProposalService.scala` — added non-mutating
  `validate(combined, user)`: reuses `validateOutputRefPositions` (sentinel-position structure),
  mirrors `DashboardProposalService.validateStructure`'s two checks (blank `dashboardName` +
  `ProposalPanelSupport.validatePanel` per panel), delegates the pipeline portion to
  `pipelineProposalService.validate`.
- `backend/src/main/scala/com/helio/api/protocols/AssistantProtocol.scala` — new:
  `AssistantTurnResult`, `AssistantProposal` (sealed: `Dashboard`/`Pipeline`/`Combined`/`Patch`),
  `AssistantStreamEvent` (sealed: `ToolCallStarted`/`ToolCallFinished`/`TurnResult`/`StreamError` —
  renamed from tasks.md's prose `Result`/`Error` to satisfy `check-schema-drift.mjs`'s global
  case-class-name-uniqueness rule against `AuthoringStreamEvent`'s own `Result`/`Error`), and
  `AssistantProtocol.assistantTools` (the bounded 6-tool list).
- `backend/src/main/scala/com/helio/api/protocols/AssistantProposalToolSchemas.scala` — new: the 4
  `propose_*` `ClaudeTool` JSON-Schema `inputSchema` definitions, split into its own file (from
  `AssistantProtocol.scala`) purely to stay inside CONTRIBUTING's file-size soft budget.
- `backend/src/main/scala/com/helio/services/AssistantSystemPrompt.scala` — new: static system-prompt
  text (role, all 6 tools, the 3-hop cap, propose-never-apply boundary, "call at most one propose_*
  tool per turn", the DataType-capability-menu rule, HEL-401's "never fabricate a resource id"
  guardrail wording carried forward).
- `backend/src/main/scala/com/helio/services/AssistantToolExecutor.scala` — new: `ClaudeToolExecutor`
  dispatching `find`/`get_resource` to `WorkspaceSearchService` (+ `PanelCapabilityService` for a
  DataType's nested `panelCapabilities`), and the 4 `propose_*` tools to the corresponding
  non-mutating `validate`/`preview` call, with the one-shot `AtomicReference` proposal side channel.
- `backend/src/main/scala/com/helio/services/AssistantService.scala` — new: `converse(history,
  message, user)` — builds the system prompt + tool set, calls `ClaudeClient.sendWithTools` with
  `maxHops = 3`, folds the outcome + side-channel proposal into `AssistantTurnResult`. No DI/route
  wiring (design.md D8).
- `backend/src/test/scala/com/helio/services/PipelineProposalServiceValidateSpec.scala` — new: task
  6.1 coverage.
- `backend/src/test/scala/com/helio/services/CombinedProposalServiceValidateSpec.scala` — new: task
  6.2 coverage.
- `backend/src/test/scala/com/helio/services/AssistantToolExecutorSpec.scala` — new: direct
  dispatch-table coverage (tasks 6.9, 6.11, plus decode-before-dispatch/unknown-tool coverage) against
  mocked repositories — no `ClaudeClient` involved.
- `backend/src/test/scala/com/helio/services/AssistantServiceSpec.scala` — new: full-loop coverage via
  a hand-written `FakeToolTransport` (tasks 6.3-6.8, 6.10, 6.12) — zero real network calls.
