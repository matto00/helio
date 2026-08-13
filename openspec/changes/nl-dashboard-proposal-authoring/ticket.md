# HEL-392: Backend NL → dashboard-proposal authoring endpoint

## Description

Today a natural-language → dashboard flow only exists via the external helio-mcp server, and even there `propose_dashboard` (`helio-mcp/src/tools/proposal.ts`) only *assembles/validates* a proposal — the actual NL→Claude authoring is done by whatever agent drives the MCP. The in-app `ProposalReviewPage` explicitly notes "wiring an in-app natural-language → Claude author for the proposal is a deliberate follow-on."

This ticket is that follow-on core: a backend endpoint that accepts a user's goal, grounds Claude in the real workspace context, and returns a **validated** `DashboardProposal` ready for the existing Proposal Review UI + apply path (`DashboardProposalService`). It reuses the proposal schema and validation end-to-end so an NL-authored proposal is validated no less strictly than a hand-authored one.

Touches: new authoring service + route (e.g. `POST /api/authoring/dashboard`) wired in `api/ApiRoutes.scala`, the Claude client (HEL-341 integration ticket — HEL-390 shipped the underlying `com.helio.ai` client), the workspace-context assembler (HEL-345/HEL-371), `DashboardProposal`/`DashboardProposalProtocol`, and the panel-capability menu (HEL-365).

## Scope

* Backend Scala: an authoring service that (1) assembles enriched workspace context (HEL-345 backend endpoint) + the panel-capability menu (HEL-365) into a system prompt, (2) calls Claude (HEL-390's `com.helio.ai.ClaudeClient`) with the user's goal, (3) parses the model output into a `DashboardProposal`, and (4) validates it via the SAME structural + binding checks the apply path uses (reuse `DashboardProposalService.validateStructure`/`preValidateBindings` logic — refactor to share, don't duplicate). Non-blocking. No fully-qualified names inline.
* Backend Scala: `POST /api/authoring/dashboard` accepting `{ goal, contextOptions? }`, returning `{ proposal, warnings }` (proposal validated but NOT applied — apply stays the user's explicit action via the existing endpoint). Support a streaming variant (SSE) so the UI can show progress.
* Prompt: instruct the model to bind only to pipeline-output DataTypes (V41) and to the panel capabilities from HEL-365; on empty workspace, return a clear "nothing to build from" signal rather than a hallucinated proposal.
* Re-prompt-on-invalid: if the model returns a structurally invalid proposal, do a bounded repair round-trip (feed the validation errors back) before failing — bounded by the cost guardrail.
* Tests: ScalaTest with a mocked Claude client returning canned proposals — valid proposal passes through; invalid proposal triggers the repair round-trip then a clean 4xx if still invalid; empty-workspace path; binding to a source-companion type is rejected.

## Acceptance criteria

- [ ] `POST /api/authoring/dashboard` returns a schema-valid `DashboardProposal` grounded in the caller's real workspace, or a structured error; it does NOT apply the proposal.
- [ ] Proposal validation reuses the apply-path checks (shared code, not a divergent copy); an NL proposal binding to a non-pipeline-output type is rejected exactly as apply would reject it.
- [ ] Grounding uses the HEL-345 workspace context + HEL-365 panel-capability menu.
- [ ] A streaming variant emits progress/tokens to the client.
- [ ] Bounded self-repair on invalid model output; empty-workspace returns a clear signal, not a hallucination.
- [ ] Cost/token guardrail (HEL-390's `com.helio.ai.ClaudeClient`) applied per request.
- [ ] `sbt test` green with a mocked Claude client (no real API call).
- [ ] Backward-compat: additive endpoint; apply path + proposal schema unchanged.

## Out of scope

* The chat UI (sibling ticket) and multi-turn conversation state (sibling ticket).
* Applying the proposal (existing `/api/dashboards/apply-proposal`).
* Pipeline authoring (HEL-342).

## Dependencies

* Depends on the HEL-341 Claude integration ticket (HEL-390, shipped: `com.helio.ai.ClaudeClient`) and the HEL-345 backend workspace-context endpoint (HEL-371). Related to HEL-365 (panel-capability menu). Feeds the chat-UI ticket.
