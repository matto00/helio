## Standing Constraints

- [C1] Never read, cat, grep, source or print any `.env` file, and never dump env (`env`, `printenv`, `sbt show Test/envVars`); ANTHROPIC_API_KEY never appears in any transcript, log, fixture or evidence file
- [C2] Red-first proof comes from recorded fixture responses (no live API call), committed red before the fix, with the red ScalaTest summary saved as evidence
- [C3] Read the ScalaTest summary ("*** N TESTS FAILED ***" / "All tests passed"), never only the sbt exit code (HEL-1468)
- [C4] Keep ClaudeClient.scala edits local to toContentBlock/toApiContentBlock/toApiToolRequest/toApiRequest/send/flattenForEstimate, the sendWithTools response branch and its recursive loop call (D3a); new ClaudeModels.scala cases go only inside object ClaudeContentBlock / object ClaudeError (HEL-1639 edits the tool-execution block and ClaudeToolRequest)
- [C5] Live spend: only task 4.3, only after every other task is green, hard cap $2 (stop at a projected $1)

### Backend

## 1. Wire and domain blocks

- [x] 1.1 ClaudeWireModels: add thinking/signature/data/raw to ClaudeApiContentBlock and stopDetails to ClaudeApiResponse (default None); compile
- [x] 1.2 ClaudeProtocol: explicit read/write for thinking, redacted_thinking, text and raw passthrough; parse stop_details; ClaudeProtocolSpec cases pass
- [x] 1.3 ClaudeModels: add ClaudeContentBlock.Thinking/RedactedThinking/Opaque and ClaudeError.NoAnswer(stopReason, category); compile
- [x] 1.4 ClaudeClient: explicit toContentBlock/toApiContentBlock cases (Opaque WARN names type only); flattenForEstimate counts new blocks; tests in group 5 pass
- [x] 1.5 D5 normalisation: toApiToolRequest (drop empty Text, emptied messages, merge same-role) before cache marking; toApiRequest (drop empty-content messages, join same-role with a blank line); tests pass
- [x] 1.6 NoAnswer per design D6: sendWithTools on refusal, or no tool_use + no text + max_tokens/pause_turn (end_turn stays FinalResponse); send on refusal or no text; tests 5.4/5.7 pass
- [x] 1.6a ClaudeClient.sendWithTools: stripAllThinking rewrites the carried history at a strip point (tools changed vs previous hop, or D5 alters a thinking-bearing message), design D3a; test 5.6 passes
- [x] 1.7 Temperature: wire field Option, None when resolved == 1.0, omitted by protocol; never top_p/top_k; WARN in ClaudeConfig.fromEnv for claude-haiku-5* with temperature != 1.0; tests pass

## 2. Assistant layer and transport

- [x] 2.0 AssistantService.toTurnResult: FinalResponse with blank text and no proposal -> Left(NoAnswer(end_turn)); with a proposal -> success (design D6); test 5.8 passes
- [x] 2.0a DashboardAuthoringService.completeStream: blank fullText -> failStreamEvent(NoAnswer), no repair call (design D6); test 5.7 passes
- [x] 2.1 AssistantService.toTurnResult: strip Thinking/RedactedThinking/Opaque and empty Text from every returned turn, keeping turn count, with a comment on the Opaque/server-tool pairing; seam test passes
- [x] 2.2 AssistantConversationRepository format: write/read for thinking, redacted_thinking, opaque (exhaustive); round-trip test passes
- [x] 2.3 NoAnswer mappings per design D6: AssistantConversationRoutes, DashboardAuthoringService, RefinementService (ModelFailure), ClaudeAiStepClient (AiStepFailure.Api(0, msg)); a test per mapping; no non-exhaustive-match warning
- [x] 2.4 HttpClaudeTransport: one INFO line per response with status and request-id header only; a test asserts the line and absence of key/body
- [x] 2.5 Deploy pin: CLAUDE_MODEL=claude-haiku-5-5 in .github/workflows/cd-backend.yml and infra/deploy-backend.sh (values + comments); CLAUDE.md CLAUDE_MODEL row names the prod pin; grep shows no claude-haiku-4-5 pin left in either file

### Frontend

## 3. Empty bubble

- [x] 3.1 ActiveConversationPanel: no MessageTurn for empty/whitespace text; lastTurnHasTrailingText uses the same predicate; jest test passes

### Tests

## 4. Proof and live check

- [x] 4.1 Red-first: commit tests 5.1-5.3 before the fix, run them against unfixed code, save the red ScalaTest summary to evidence/red-first.md
- [x] 4.2 Full gates green: sbt testFull (summary read, C3), npm test, lint, typecheck, format:check; outputs summarised in evidence/gates.md
- [x] 4.3 Live check per design D12 (C1, C5): conversation A (2 messages, a tool hop, message 2 succeeds) and conversation B (web_search then another hop; UNEXERCISED if no search after one retry); request-ids, usage, search count, cost in evidence/live-check.md (DONE cycle 2 on the merged head; web search exercised; repair loop not exercised; see evidence/live-check.md)

## 5. Test cases (fixture JSON under backend/src/test/resources/claude/)

- [x] 5.1 Seam: Haiku-5.5-shaped response (thinking "" + signature, then text) through ClaudeProtocol read -> sendWithTools -> AssistantService -> repository JSON round trip -> second converse; serialized second request has no empty text block and no thinking block; persisted turn has no empty text
- [x] 5.2 Tool loop: hop 1 [thinking, redacted_thinking, tool_use]; hop 2 request JSON assistant content byte-equal to hop 1 blocks (signature, empty thinking, data, order)
- [x] 5.3 Guard: unknown block type never becomes Text, is sent back verbatim in-loop, is stripped from the persisted turns; legacy Text("") history never serialises an empty text block
- [x] 5.4 Refusal fixture and thinking-only max_tokens fixture -> NoAnswer; route returns the design D6 message and persists nothing
- [x] 5.5 Default temperature omitted (send and tool request), 0.5 sent, no top_p/top_k ever; converse request always ends with a user turn (fresh, continued, dangling tool_use)
- [x] 5.6 Strip point: hop 1 [thinking S1, server_tool_use web_search, web_search_tool_result, tool_use] -> hop 2 tools differ, no S1; hop 2 [thinking S2, tool_use], no search -> hop 3 has S2 byte-exact and no S1; without a search, S1 byte-exact on hop 2
- [x] 5.7 Single-shot: send refusal -> Left(NoAnswer); AI step fails (no empty output); authoring stream with blank text ends in a fail event and makes no repair send; toApiRequest with an empty assistant message serialises no empty message
- [x] 5.8 Proposal then empty end_turn: hop 1 [thinking, tool_use propose_dashboard], hop 2 {end_turn, content []} -> turn succeeds, proposal tool_use/tool_result persisted, next request has no empty message; blank end_turn with no proposal -> NoAnswer(end_turn)
