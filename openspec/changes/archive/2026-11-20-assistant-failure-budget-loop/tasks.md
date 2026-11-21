## Lane Constraints (driver brief)

- L1: NEVER read/cat/grep/source/print any .env file; never run env-dumping commands; never copy a .env or a tree containing one. Only scripts/concertino/.concertino.env may be read by scripts, never printed.
- L2: Quoted heredocs only (<<'EOF').
- L3: No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue with buildUserDeleteSql by exact id.
- L4: jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- L5: Bash timeout 600000; sbt testFull in shards that fit the timeout; no background run past the tool timeout.
- L6: No live model call: any backend started with ANTHROPIC_API_KEY exported empty; tests use the fake transport.
- L7: Red first with mutations; run full spec files; commit the red run before implementation code.
- L8: Lane-private DB helio_hel1637 for start-servers.sh and Playwright.

## 1. Red first

- [x] 1.1 Add the AssistantServiceSpec test "6 successful round trips then a final answer completes" (fake transport, no budget stop) and run the full AssistantServiceSpec; record the failing run (cut off at hop 5) in `.concertino/scratch/HEL-1637/red-run.txt` and commit the test alone before any implementation.

## 2. Client loop (ClaudeModels / ClaudeClient)

- [x] 2.1 Add `ToolFailureBudget`, `FailedToolCall`, `ClaudeToolRequest.failureBudget` and `stopOnInputBudget`, outcomes `FailureBudgetExhausted` and `InputBudgetExhausted`, and `hopsUsed`/`failedToolCalls` on every history-carrying outcome (second parameter list for the existing ones; design D2, D4, D6); verify the backend compiles with exhaustive matches updated in AskDataService, ClaudeInsightClient and AssistantEval (D9) and their specs still pass.
- [x] 2.2 Implement the failure count in `sendWithTools` (executed calls only, total across hops, stop after the round trip with the Nth failure) and the mid-loop input stop (hop >= 2 only); verify with new ClaudeClientSpec tests: 3rd failure stops with exact transport-call count, 2 failures then success completes, once-per-response rejections not counted, all parallel results returned, `None` unchanged, mid-loop input stop vs hop-1 refusal with zero transport calls.
- [x] 2.3 ClaudeClientSpec: ceiling 12 (13 transport calls, 13th tool_use not executed) and web-search tool omitted after `webSearchMaxUses` across more than 4 round trips; verify the full ClaudeClientSpec passes.

## 3. AssistantService

- [x] 3.1 Pass `maxHops = 12`, `failureBudget = Some(ToolFailureBudget(3, classify))` (design D2/D3) with the `isError || test_connection ok:false` classifier, `stopOnInputBudget = true`; map outcomes to `stopReason`/`hopsUsed`/`failedToolCalls`; compose stop messages (D5); append the assistant stop-text turn for failure_budget and input_budget; verify the red test from 1.1 now passes.
- [x] 3.2 AssistantServiceSpec: 3 failures interleaved with successes -> plain-language message (never "maximum number of tool calls"), persisted assistant text turn, `stopReason failure_budget`; 3x test_connection ok:false -> "connect to the source" with the `TestConnectionResponse.error` text and no `{"ok"` in the message; a captured proposal then 3 failures -> the "I put together a proposal, but..." wording; third failure on round trip 12 -> `failure_budget`, not `hop_ceiling`; 2 failures then answer completes; ceiling -> `hop_ceiling` + `stopMessage` + dangling tool_use kept; next turn after a failure-budget stop sends alternating roles ending with a user turn; mid-turn input stop persists work so far. Verify the full spec file passes and each named mutation in design D10 turns a test red (record in `.concertino/scratch/HEL-1637/mutations.md`).

## 4. Protocol, route, telemetry, schema

- [x] 4.1 Add `stopReason`/`stopMessage` to the converse response (absent on GET) and the JSON schema; telemetry adds `hopsUsed`/`failedToolCalls`/`stopReason`; verify AssistantConversationRoutesSpec and AssistantTelemetrySpec (new fields present, no error text; a turn with 2 failures then a final answer records `failedToolCalls` 2 and `stopReason` `final`) and the schema-drift check pass.
- [x] 4.2 AssistantConversationRoutesSpec: a beta turn of 7 round trips raises `assistant_daily_usage` by exactly the model weight once; first-request input over the limit is still a refused error with nothing persisted; after an `input_budget` stop the next send on that conversation is the guardrail error with nothing persisted. Verify the full spec passes.

## 5. Web client

- [x] 5.1 Carry `stopReason`/`stopMessage` through types and slice; `MessageTurn` note per reason; the ceiling fallback bubble shows `stopMessage` (generic fallback text, no hop count); remove the "3 lookups" text. Verify with jest tests for MessageTurn/ActiveConversationPanel (failure-budget note, ceiling fallback with stopMessage, no "3 lookups"), plus `npm run lint` and `npm run typecheck`.

## 6. Verification and evidence

- [x] 6.1 Run backend gates (sbt testFull in shards, compile warnings clean) and frontend gates (jest 3 workers, lint, typecheck, format:check); record results.
- [x] 6.2 Write the PR-ready measurement note (numbers from `.concertino/runs/HEL-1637/evidence/turn-measurements.md`, the ceiling ruling, D1 reasoning, HEL-721 interaction) into `openspec/changes/assistant-failure-budget-loop/pr-notes.md`.
