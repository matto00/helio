## Context

See proposal.md (Why). Current state, verified on main at ba30212be:

- `AssistantService.MaxHops = 4` is the only cap on the converse path. `ClaudeClient.sendWithTools` executes tools on
  round trips 1..`maxHops`; a response asking for tools on round trip `maxHops + 1` resolves
  `ClaudeToolOutcome.HopBudgetExhausted(history :+ thatResponse, usage)` with its `tool_use` blocks unexecuted.
  `AssistantService.seedHistory` already pairs those dangling ids with synthetic `isError` results on the next turn.
- The "3" the owner sees is the web client: `ActiveConversationPanel.tsx` renders the fixed fallback text
  "I couldn't find enough in 3 lookups — can you narrow this down?" whenever `hopBudgetExhausted` is true and the
  last turn has no text (always the case on a cap stop). The server's own text ("Reached the maximum number of tool
  calls (4)...") is in `AssistantTurnResult.text` but never shown.
- Tool failure shapes: `AssistantToolExecutor.execute` returns `Left(message)` for unknown tools, bad input, decode
  and validate/preview failures and failed reads; `ClaudeClient.executeTool` turns `Left`/throw/failed future into a
  `ToolResult(isError = true)`. `test_connection` returns `Right(json)` with `"ok": false` when the source is
  unreachable, so `isError` alone misses it. HEL-1639's once-per-response rule returns a synthetic `isError` result
  for every later `propose_*` in one response without running it.
- HEL-1636 (merged) added `prepareHop` / history normalisation (strips thinking, merges same-role neighbours) and
  the `Failed(..)(usage, responseModel)` second parameter list idiom.
- The beta daily-cap charge is taken once in `AssistantConversationRoutes` before `converse` runs
  (`chatAccessService.checkConverseCap(user, tier, weightOf(model), ...)`), so it is per turn, not per hop.
- The input-token guardrail (`guardrailRejectTool`) runs before EVERY hop; today a rejection on hop k > 1 resolves
  `Failed(GuardrailExceeded)`, which `converse` maps to `Left`, discarding k-1 hops of work and persisting nothing.

Measurements (no live model call; `.concertino/runs/HEL-1637/evidence/turn-measurements.md`):
- 27 real tool-using turns persisted in local dev (gate and verification traffic, older models): hops 1:13, 2:5,
  3:8, 4:1 (censored at the cap); failed calls per turn never above 1.
- Owner prod transcript 2026-10-16 (haiku-4-5, 7 turns): calls per turn 2, 6, 3, 3, 8, 4, 12; failed calls per
  turn 0, 1, 3, 1, 4, 0, 12. Turn 5 recovered after one round trip of 4 parallel failures; turn 7 had 12 failures
  in 3 round trips.
- Ceiling: the data cannot set it (every turn was capped at 4). Owner ruled **12** (escalation answered
  2026-11-20).

## Goals / Non-Goals

**Goals:** failure budget of 3 + ceiling of 12 on the workspace assistant only; plain-language stop messages that
reach the user; a clean mid-turn stop on the input-token limit; telemetry of hops, failures and stop reason; keep
web-search budget, beta charge and first-request input refusal exactly as they are, with tests.

**Non-Goals:** the ask loop (`AskDataService`, HEL-1745, its own `MaxHops = 4`): the ticket names only the
workspace assistant; it only gets the mechanical exhaustive-match updates the new outcomes force, with unchanged
behaviour. Streaming / per-hop progress (HEL-721). Prompt or tool-schema changes (HEL-1639), except that the one hard-rule line stating the hop limit is updated to the new
ceiling and failure budget (interpolated from the code constants): a factual consequence of this change, not new guidance. Any new environment
variable: both numbers are code constants like `MaxHops` today.

## Decisions

### D1. Failure unit: an executed tool call; counted in total per turn, not consecutively
- **Total, not consecutive.** The owner's wording is "3 failed tool calls in a turn". A consecutive count resets on
  every success, so the exact pattern in the 2026-10-16 transcript and HEL-1639's taxonomy (fail a propose, re-read
  with get_resource, fail the propose again, ...) never trips it and runs to the ceiling: 12 billed round trips
  that produce nothing. A total count bounds wasted spend at 3 failures deterministically. The cost of total is that
  a turn which recovered from 2 unrelated failures has one left; the measured productive turns show at most 1-3
  failures, and the user can simply continue in the next turn (the new turn gets a fresh budget).
- **Per executed call, not per round trip.** The ticket and the owner say "failed tool calls" and give "after 3
  tries" as the message. Counting round trips would let a fan-out of N failing parallel reads count as 1. Parallel
  fan-out of `propose_*` (the transcript's 4x pattern) is already reduced to one executed call per response by
  HEL-1639, so per-call counting no longer ends a turn after one fan-out of proposes.
- **What counts:** a `ToolResult` with `isError = true` for a call that was actually dispatched to the executor
  (unknown tool, invalid input, propose decode or validation failure, failed get_resource/find, thrown executor
  error), and a `test_connection` result whose JSON has `"ok": false`.
- **What does not count:** HEL-1639's synthetic once-per-response rejections (never ran; their cost is one round
  trip at most, bounded by the ceiling, and the rejection text already tells the model what to do); the synthetic
  results `seedHistory` writes for a previous turn's dangling calls (not this turn's calls); server-side
  `web_search` (Anthropic-executed, already bounded by `CLAUDE_WEB_SEARCH_MAX_USES`).
- **Alternatives rejected:** consecutive failures (above); per-hop counting (above); counting synthetic rejections
  (a single 4-propose fan-out would cost 3 failures at once and end the turn with nothing tried).

### D2. The budget lives in `ClaudeClient.sendWithTools`, opt-in and caller-supplied
`ClaudeToolRequest` gains `failureBudget: Option[ToolFailureBudget] = None`, where
`ToolFailureBudget(maxFailures: Int, classify: (ClaudeContentBlock.ToolUse, ClaudeContentBlock.ToolResult) => Option[String])`.
`classify` returns the failure's plain message, or `None` when the call did not fail. The loop applies `classify`
only to results of calls it actually dispatched to `executeTool` (never to the once-per-response synthetic results),
accumulates `failedCalls: Vector[FailedToolCall(name: String, message: String)]` across hops, and after a round
trip's results are all collected: if `failedCalls.size >= maxFailures`, it resolves the new outcome
`ClaudeToolOutcome.FailureBudgetExhausted(history :+ assistantTurn :+ userTurn, usage, failedCalls)` instead of
recursing. No further transport call. This check runs before the next round trip's hop-cap check, so a third
failure on round trip 12 is a `failure_budget` stop, not a ceiling stop. `None` (every other caller) keeps today's
behaviour exactly.

`AssistantService` supplies `classify`:
- `result.isError` -> `Some(result.content)` (the executor's own error text, which the tool-call row already shows);
- `toolUse.name == "test_connection"` and the result JSON has `"ok": false` -> `Some(error)` taken from the
  `TestConnectionResponse` `error` field, or the fixed phrase "the source did not respond" when `error` is absent,
  so the stop message never shows raw JSON;
- otherwise `None` (unparseable JSON or missing `ok` is not a failure; real errors already arrive as `isError`).

Rationale for client-side over service-side counting: the loop is the only place that can stop between round trips;
a service-side executor wrapper cannot prevent the next model request. Alternative rejected: a mutable counter in
`AssistantToolExecutor` that short-circuits later calls (still pays for every further model request and needs the
client to stop anyway). Spec delta: `specs/claude-api-client/spec.md` (ADDED failure-budget requirement).

### D3. Ceiling = 12 via the existing `maxHops`
`AssistantService` passes `maxHops = 12` (named `HopCeiling`) and `failureBudget = Some(ToolFailureBudget(3, classify))` (named `FailureBudget = 3`). `maxHops` semantics and
`HopBudgetExhausted` are unchanged: 12 round trips may execute tools; a 13th tool request is not executed.
Telemetry (D7) makes it measurable whether 12 is ever reached. Edge: the guardrail runs before each transport call,
so if the 13th request itself trips the input limit the stop is `input_budget`, not `hop_ceiling`; tests must not
encode the opposite.

### D4. Mid-turn input-token stop
`ClaudeToolRequest` gains `stopOnInputBudget: Boolean = false`. When true and `guardrailRejectTool` rejects a hop
with `hopsUsed >= 1`, the loop resolves `ClaudeToolOutcome.InputBudgetExhausted(carriedHistory, usage)` instead of
`Failed(GuardrailExceeded)`. Hop 1 (`hopsUsed == 0`) still resolves `Failed(GuardrailExceeded)` with zero transport
calls, so the refusal-before-sending contract and the converse `Left` are unchanged. The guardrail estimate itself
is unchanged. `AssistantService` sets it true. Spec delta: `specs/claude-api-client/spec.md` (MODIFIED guardrail
requirement: default stays `Failed`; opt-in plus at least one hop -> `InputBudgetExhausted`; hop 1 always `Failed`).
**Consequence, stated as certain:** after an `input_budget` stop the persisted conversation already exceeds the
limit, so every later send in that conversation is refused at hop 1 with the existing guardrail error (nothing
persisted). Today the whole turn is discarded instead and the conversation stays sendable. The trade is deliberate:
the turn's work (reads, a captured proposal) is kept and the stop message tells the user to start a new
conversation; the PR says so. Size check: the system prompt is about 4k tokens and the measured
turns add 0.5-2k tokens per round trip, so 12 round trips normally stay far below 100k; this stop covers a turn that
reads several large resources on top of a long conversation, which today loses the whole turn.

### D5. Stop messages and how they reach the user
`AssistantService` composes the message, never the client:
- **failure_budget:** grouped by the failed calls' tool names. All `test_connection` -> "I couldn't connect to the
  source after N tries." All `propose_*` -> "I couldn't put together a valid proposal after N tries." All
  `find`/`get_resource` -> "I couldn't read what I needed from your workspace after N tries." Mixed or unknown ->
  "I stopped after N tool calls failed." Then "The last error was: <first line of the last failure, at most 200
  characters>." and "Tell me what to change, or ask me to try again." The message is chosen from the
  `FailedToolCall` messages produced by `classify` (D2), never from raw tool-result JSON. When the turn already
  captured a valid proposal (`executor.proposal` is set), the propose wording is replaced by "I put together a
  proposal, but then N tool calls failed." so the text never contradicts a proposal the user can see. The error text is the same text the tool-call
  row already shows the user. No "maximum number of tool calls".
- **input_budget:** "This conversation got too long for me to keep working on it in one go. Start a new
  conversation, or ask about one thing at a time."
- **hop_ceiling:** "I stopped after 12 steps without finishing. Tell me which part to focus on, or ask me to
  continue."

Persistence: for `failure_budget` and `input_budget` the returned `fullHistory` ends with a user turn of tool
results; `AssistantService` appends `ClaudeToolMessage(Assistant, Seq(Text(stopMessage)))`, so the transcript
alternates cleanly, the message is visible after reload, and the next turn's model request sees why it stopped.
For `hop_ceiling` the history keeps today's shape (trailing assistant turn with unexecuted `tool_use`, handled by
`seedHistory`); appending a second assistant turn there would put text after `tool_use` once the normaliser merges
same-role neighbours, an ordering not exercised anywhere today.
Model stamp: the route stamps every new assistant turn with the model that answered (HEL-1755 D5); the appended
stop-text turn will carry that stamp too. Accepted: it is the model the turn ran on, the label is informational,
and adding a per-turn "server-authored" marker is out of scope. Its message travels in the response's
`stopMessage` and the web client shows it in the existing fallback bubble. `AssistantTurnResult.text` is the stop
message in all three cases. The FinalResponse path is unchanged.

### D6. Response and result shape
Every history-carrying outcome exposes the loop's own counts: `FinalResponse` and `HopBudgetExhausted` gain
`hopsUsed: Int` and `failedToolCalls: Int` in their second parameter list (defaults 0, so existing patterns and
equality are unchanged); `FailureBudgetExhausted` and `InputBudgetExhausted` carry the same two values (the former
also its `failedCalls` list). The count therefore always comes from the loop's classifier, never re-derived from
history by `isError` (which would miscount the once-per-response rejections and dangling-call results D1
excludes). `AssistantTurnResult` gains `stopReason: String` (`final | failure_budget | hop_ceiling |
input_budget`), `hopsUsed: Int`, `failedToolCalls: Int`. A turn with 2 failures that then answers reports
`failedToolCalls = 2`, `stopReason = final`. The converse response (`AssistantConversationDetail`) gains optional
`stopReason` and `stopMessage`, converse-only and absent on GET exactly like `hopBudgetExhausted`;
`hopBudgetExhausted` stays true only for `hop_ceiling`. `schemas/assistant/assistant-conversation.schema.json`
adds both as optional properties.

### D7. Telemetry
`AssistantTelemetry.emitToolLoopOutcome` adds `hopsUsed`, `failedToolCalls`, `stopReason` (integers and a fixed
token; never tool input or error text). Emitted on every `Right` as today, so all four stop reasons are recorded.

### D8. Web client
`types.ts`/slice carry `stopReason`/`stopMessage` from the converse response. `ActiveConversationPanel` passes
`stopReason` for the most recent text block; `MessageTurn` shows a note per reason ("Stopped after repeated
errors", "Stopped: conversation too long", "Couldn't finish in one go" for the ceiling). The ceiling fallback bubble
renders `stopMessage` (fallback text for an older server without it: "I couldn't finish this in one go. Can you
narrow it down?"), so no fixed hop count is shown anywhere. DESIGN.md tokens only; no new component.

### D9. Exhaustive matches
`AskDataService` and `ClaudeInsightClient` match on `ClaudeToolOutcome`. They never set `failureBudget` or
`stopOnInputBudget`, so the new outcomes cannot occur for them; add arms that map them exactly like
`HopBudgetExhausted` / `Failed` today, with a comment, so the compiler stays exhaustive and behaviour is unchanged.

### D10. Tests (red first, fake transport only; no live model call)
- `AssistantServiceSpec` (red, committed before implementation): 6 successful round trips then a final answer
  completes with no budget stop (fails today at hop 5).
- `ClaudeClientSpec`: failure budget stops after the round trip with the 3rd failure (exact transport call count);
  2 failures then success completes; once-per-response rejections do not count; parallel calls in the third-failure
  round trip all return results; `failureBudget = None` unchanged; ceiling 12 (13th response not executed, 13
  transport calls); mid-loop input stop (`stopOnInputBudget`) vs hop-1 refusal (zero transport calls, `Failed`);
  web-search tool omitted after `webSearchMaxUses` across more than 4 round trips.
- `AssistantServiceSpec`: 3 failures with successes in between -> plain-language message, persisted assistant text
  turn, `stopReason`; `test_connection ok:false` x3 -> "connect to the source" message; ceiling -> `hop_ceiling`,
  `stopMessage`, dangling tool_use preserved; next turn after a failure-budget stop sends a request ending with a
  user turn and alternating roles.
- `AssistantConversationRoutesSpec`: a 7-round-trip beta turn increases `assistant_daily_usage` by exactly the
  model's weight once; converse response carries `stopReason`/`stopMessage`; GET omits them.
- `AssistantTelemetrySpec` / routes: new fields present, no error text; a turn with 2 failures then a final answer
  records `failedToolCalls` 2 and `stopReason` `final`.
- Web client jest: failure-budget note and ceiling fallback with `stopMessage`; no "3 lookups" text.
Mutation checks the evaluator can re-run: count consecutive instead of total; count synthetic rejections; drop the
`ok:false` rule; set `maxHops` back to 4; send hop-1 over-limit requests; re-derive the failure count from history by `isError`;
show raw `test_connection` JSON in the message.

## Risks / Trade-offs

- [Longer turns mean longer waits and more spend per turn] -> ceiling 12 bounds it; failure budget ends
  pathological turns early; telemetry `hopsUsed`/`stopReason` lets the owner tune; HEL-721 streaming is the
  intended companion (noted in the PR).
- [Total count ends a recovering turn on its third unrelated failure] -> accepted (D1); the next user turn gets a
  fresh budget and the message says what failed.
- [Server-authored text in the assistant's voice is fed back to the model next turn] -> it is a short factual
  status; the model already sees the failed tool results above it.
- [Persisted history grows faster with 12 round trips, so a later turn's first request may hit the input refusal
  sooner] -> unchanged contract (refused before sending, clear error); D4 covers growth within a turn.
- [After an `input_budget` stop the conversation is certain to refuse every further send (D4)] -> deliberate; the
  stop message says to start a new conversation; stated in the PR; tested (next send is the guardrail error,
  nothing persisted).
- [Per-call counting: one response with 3 parallel failing reads ends the turn after one round trip] -> the D1
  trade-off; noted in the PR.
- [Turn 3 of the 2026-10-16 transcript (3 failed calls out of 3) would now stop on the failure budget] -> consistent
  with the owner's "3 failures"; noted in the PR.
- [The ceiling number is a ruling, not a measurement] -> stated in the PR with the censored data; telemetry makes
  the next decision measurable.
