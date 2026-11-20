## MODIFIED Requirements

### Requirement: A bounded 7-tool conversational loop answers a goal
`AssistantService.converse(history, message, user)` SHALL run `ClaudeClient.sendWithTools` with the tool
set `[find, get_resource, test_connection, propose_dashboard, propose_pipeline, propose_combined,
propose_patch_set]`, `webSearch = true` (Anthropic's server-side `web_search` tool — offered on every
call, unconditionally, never gated on message content or intent), a failure budget of 3 failed tool calls and a hop ceiling of 12 (see "The tool loop stops on a failure budget or a hop ceiling"), returning an
`AssistantTurnResult` carrying the final text and, when a `propose_*` tool call validated successfully
during the turn, the structured proposal object it produced.

#### Scenario: A goal answerable from existing workspace data produces a DashboardProposal
- **WHEN** `converse` is called with a goal matching an existing Output, and the scripted tool-use
  sequence resolves via `find` then a successful `propose_dashboard` call
- **THEN** the result's `proposal` is `Some(AssistantProposal.Dashboard(_))` carrying a
  `DashboardProposal` of the same quality `DashboardAuthoringService` would have produced

#### Scenario: A goal with no matching data falls back to propose_pipeline, with no special-case code
- **WHEN** `converse` is called with a goal for which `find` returns no matching Output, and the
  scripted tool-use sequence resolves via a subsequent successful `propose_pipeline` (or
  `propose_combined`) call
- **THEN** the result's `proposal` reflects the pipeline (or combined) proposal — achieved purely
  through the system prompt and tool availability, with no `AssistantService` branching on whether
  `find` returned results

#### Scenario: A goal answerable without any proposal returns text only
- **WHEN** `converse` is called with a goal fully answerable via `find`/`get_resource` alone (e.g. a
  factual question), and Claude's final response contains no `propose_*` call
- **THEN** the result's `proposal` is `None` and `text` carries Claude's final answer

#### Scenario: web_search is offered on every call, whether or not Claude chooses to use it
- **WHEN** `converse` is called with any goal, and Claude's scripted response never invokes
  `web_search`
- **THEN** the outbound `ClaudeToolRequest` still carries `webSearch = true`, and the turn completes
  normally with no web_search call having occurred

#### Scenario: A REST-source proposal turn can ground itself via web_search before proposing
- **WHEN** `converse` is called with a goal requiring a new inline REST source, and the scripted
  tool-use sequence includes a `web_search` call before the eventual `propose_pipeline` call
- **THEN** the turn completes normally, `propose_pipeline`'s `test_connection` requirement (see "An
  inline REST/SQL source must be connection-tested before its proposal finalizes") still applies
  unchanged, and the web_search call does not count as a hop or against the failure budget

## REMOVED Requirements

### Requirement: The hop cap is 4, supplied by the caller
**Reason**: Replaced by "The tool loop stops on a failure budget or a hop ceiling" (HEL-1637): a total-hop cap of 4
cut productive turns off just before they answered.
**Migration**: None. The ceiling is still caller-supplied (12), and a ceiling stop still reports `hopBudgetExhausted`.

## ADDED Requirements

### Requirement: The tool loop stops on a failure budget or a hop ceiling
`AssistantService` SHALL run the tool loop until the model returns a final response, until 3 failed tool calls have
been made in the turn, or until 12 tool-executing round trips have run and the model asks for another tool call,
whichever comes first. Both numbers SHALL be supplied by the caller, never defaulted inside the client.

A failed tool call SHALL be an executed tool call whose result is an error (an unknown tool, invalid input, a
propose decode or validation failure, a failed read), or a `test_connection` call whose result reports `ok: false`.
Failures SHALL be counted in total across the turn, not consecutively; a successful call does not reset the count.
A call rejected without running because only one `propose_*` call per response is evaluated SHALL NOT count, and
neither SHALL a synthetic result for a previous turn's unexecuted call nor a server-side `web_search` call. When the
third failure lands in a round trip that ran several calls, every call of that round trip SHALL still return its
result before the turn stops, and no further model request SHALL be sent.

#### Scenario: Six successful round trips then a final answer complete
- **WHEN** a turn's model responses request tools on 6 consecutive round trips, every call succeeds, and the 7th
  response is a final answer
- **THEN** the turn completes with that answer, its proposal (if any), and no budget stop

#### Scenario: Three failed calls stop the turn with a plain-language message
- **WHEN** a turn makes 3 tool calls that fail, with successful calls in between, and the model would keep calling
  tools
- **THEN** no model request is sent after the round trip that produced the third failure
- **AND** the turn ends with an assistant message, persisted as the turn's last message, that names what failed in
  plain language (for example that it could not connect to the source after 3 tries) and never says "maximum number
  of tool calls"
- **AND** the converse response reports `stopReason: "failure_budget"`

#### Scenario: Two failures do not stop the turn
- **WHEN** a turn makes 2 failing tool calls and then succeeds and answers
- **THEN** the turn completes normally with the model's answer

#### Scenario: A test_connection that reports not-ok counts as a failure
- **WHEN** 3 `test_connection` calls in one turn each return a result with `ok: false`
- **THEN** the turn stops on the failure budget and the message says the source could not be connected to

#### Scenario: One-proposal-per-response rejections are not failures
- **WHEN** one model response contains four `propose_pipeline` calls and the first one validates
- **THEN** the three rejected calls do not count toward the failure budget

#### Scenario: The ceiling stops a pathological loop
- **WHEN** the model requests a successful tool call on every round trip and never answers
- **THEN** exactly 12 round trips execute tools, the 13th response's tool calls are not executed, no further
  request is sent, and the converse response reports `hopBudgetExhausted: true`, `stopReason: "hop_ceiling"` and a
  `stopMessage` saying the assistant stopped after 12 steps without finishing

#### Scenario: The input-token limit reached mid-turn ends the turn cleanly
- **WHEN** at least one round trip has run and the next request's estimated input tokens exceed
  `CLAUDE_MAX_INPUT_TOKENS`
- **THEN** that request is not sent, the turn ends with the work so far plus a plain-language assistant message
  saying the conversation grew too long, and the converse response reports `stopReason: "input_budget"`

#### Scenario: A first request over the input-token limit is still refused
- **WHEN** the very first request of a turn exceeds `CLAUDE_MAX_INPUT_TOKENS`
- **THEN** no request is sent and the converse call fails with the existing guardrail error, persisting nothing

#### Scenario: The web-search budget still holds across a long turn
- **WHEN** a turn runs more than 4 round trips and the model uses web search on several of them
- **THEN** no more than `CLAUDE_WEB_SEARCH_MAX_USES` web searches are offered across the whole turn

#### Scenario: A long turn is charged once against the beta daily cap
- **WHEN** a beta-tier user's converse turn runs 7 round trips
- **THEN** the daily usage counter increases by exactly the model's weight once for that turn

### Requirement: The conversation view shows the stop message
The conversation view SHALL show the server's stop message for the turn that just ended on a budget, with a short
note naming the kind of stop, and SHALL NOT show a fixed hop count of its own.

#### Scenario: Failure-budget stop in the conversation view
- **WHEN** a converse response reports `stopReason: "failure_budget"`
- **THEN** the last assistant bubble shows the persisted plain-language message with a note that the assistant
  stopped after repeated errors

#### Scenario: Ceiling stop in the conversation view
- **WHEN** a converse response reports `stopReason: "hop_ceiling"` and the last turn has no text of its own
- **THEN** a fallback assistant bubble shows the response's `stopMessage`, and no "3 lookups" text appears

### Requirement: The system prompt SHALL state the loop's real limits
`AssistantSystemPrompt` SHALL tell the model the hop ceiling and the failure budget the loop enforces (up to 12
tool-call round trips per turn; the turn stops after 3 failed tool calls), taken from the same constants the loop
uses, so the prompt can never state a cap the code no longer has.

#### Scenario: The prompt names the ceiling and the budget
- **WHEN** the system prompt text is built
- **THEN** it contains the hop ceiling and the failure budget from the loop's constants and no longer says the model
  has "at most 4 hops"
