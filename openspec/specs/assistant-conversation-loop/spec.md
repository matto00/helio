# assistant-conversation-loop Specification

## Purpose
A bounded, 7-tool Claude conversation loop (`AssistantService.converse`) that answers a workspace
goal by searching (`find`/`get_resource`), verifying reachability of any new inline REST/SQL source
(`test_connection`), and proposing (`propose_dashboard`/`propose_pipeline`/`propose_combined`/
`propose_patch_set`) — never applying, so a human always reviews before anything is mutated — the
core entry point HEL-659's top-level workspace assistant is built around.

## Requirements

### Requirement: No apply-shaped tool is ever offered to Claude
The tool set `AssistantService` passes to `sendWithTools` SHALL NOT include any tool whose backing
implementation calls a mutating `apply`/create/update/delete endpoint — every `propose_*` tool SHALL
call only a non-mutating validate/preview path.

#### Scenario: The tool list contains no apply-shaped tool
- **WHEN** the tool list `AssistantService` passes to `sendWithTools` is inspected
- **THEN** no tool's name or description denotes an apply/mutate operation, and every `propose_*`
  tool's backing call is one of `DashboardProposalService.validate`,
  `PipelineProposalService.validate`, `CombinedProposalService.validate`, or
  `PatchSetPreviewService.preview` — never an `apply` method

#### Scenario: A validation failure is fed back to Claude, not raised as an exception
- **WHEN** a `propose_*` tool call's underlying validate/preview call returns `Left`
- **THEN** the failure is fed back to Claude as an `isError` tool_result within the remaining hop
  budget, and `AssistantService.converse`'s returned `Future` does not fail

### Requirement: get_resource on a DataType includes panel-capability grounding
A `get_resource` tool call for `resourceType == "dataType"` (the wire-exempted resourceType value that
now sources from `OutputRepository` — design.md's "value-exemption" decision) SHALL include the Output's
`PanelCapabilitiesResponse` (bindable panel kinds, required/optional slots) in its tool_result
payload as a distinct nested key alongside (never flat-field-unioned with) the existing Output
detail, so Claude has the same bindable-panel-kind grounding `DashboardAuthoringService` injects
into its own prompt today, without requiring a second tool call and without either payload's own
`columns` field silently overwriting the other's.

#### Scenario: get_resource on a DataType returns both detail and capability grounding, uncollided
- **WHEN** `get_resource` is called for an owned Output's id
- **THEN** the tool_result payload nests the Output's detail (columns/sample rows/stats) and its
  panel-capability menu (bindable kinds + required/optional slots) under distinct top-level keys,
  and both payloads' own `columns` fields are present and intact

### Requirement: converse's result exposes the full turn history for persistence
`AssistantTurnResult` SHALL carry the complete updated message history (`fullHistory:
Seq[ClaudeToolMessage]`) a `converse` call produced — the caller-supplied history plus every new
turn (the user's message, any `tool_use`/`tool_result` blocks, Claude's final response) — so a
caller can persist the conversation's continuation without re-deriving it.

#### Scenario: fullHistory includes the new user turn and Claude's final response
- **WHEN** `converse` resolves to `ClaudeToolOutcome.FinalResponse`
- **THEN** `AssistantTurnResult.fullHistory` includes the original history, the new user message
  turn, and Claude's final response turn, in order

#### Scenario: fullHistory is populated even when the hop budget is exhausted
- **WHEN** `converse` resolves to `ClaudeToolOutcome.HopBudgetExhausted`
- **THEN** `AssistantTurnResult.fullHistory` still reflects every turn produced up to that point,
  not an empty or partial sequence

### Requirement: converse surfaces a real Claude/transport failure as an error, never a fabricated result
`AssistantService.converse` SHALL return `Left(ClaudeError)` when the underlying call resolves to
`ClaudeToolOutcome.Failed`, never a value-less or fabricated `AssistantTurnResult` for that case.

#### Scenario: A real API failure is represented as an error, not silently absorbed
- **WHEN** `converse` resolves to `ClaudeToolOutcome.Failed`
- **THEN** `converse`'s result is `Left` carrying the underlying `ClaudeError`, not a `Right`
  containing an empty or synthesized `AssistantTurnResult`

### Requirement: converse's result signals when a search found nothing
`AssistantTurnResult` SHALL carry a `searchedWithNoResults: Boolean` field, `true` when the turn's
outcome is `FinalResponse` (no proposal captured) and the last tool call executed in this turn's
new history was a `find` call whose result was an empty array — `false` otherwise, including when
no `find` call was made at all.

#### Scenario: A zero-result find followed by a plain final answer sets the flag
- **WHEN** the scripted executor's `find` call resolves to `Right("[]")` and the transport's next
  response is a final text block with no further tool call
- **THEN** `AssistantTurnResult.searchedWithNoResults` is `true`

#### Scenario: A find call with results does not set the flag
- **WHEN** the scripted executor's `find` call resolves to a non-empty result array and the
  transport's next response is a final text block
- **THEN** `AssistantTurnResult.searchedWithNoResults` is `false`

#### Scenario: A turn with no find call does not set the flag
- **WHEN** a turn's tool calls never include `find` (e.g. only `get_resource`)
- **THEN** `AssistantTurnResult.searchedWithNoResults` is `false`

### Requirement: Every propose_* tool's guidance carries a concrete worked example
The four `propose_*` tools SHALL each carry at least one fully-formed worked example of a schema-valid call
(`propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set`): a top-level
JSON-Schema `examples` array in the tool's `inputSchema` containing at least one complete input object, and the
static system prompt SHALL include a compact shaping-guidance section covering the `propose_combined`
`"$pipelineOutput"` sentinel, the `propose_patch_set` `target`/`op`/`patch` shape **including `target.parentId`
for a create edit**, and the pipeline **roots** existing-vs-inline branch exclusivity **per root**. Example
resource ids SHALL be obviously-synthetic placeholders, and the guidance SHALL state explicitly that real calls
must only use ids returned by `find`/`get_resource` — the examples must reinforce, never weaken, the existing
never-fabricate-ids rule.

Every worked example and every line of shaping guidance SHALL describe the shape the backend actually accepts.
An example or instruction teaching a singular `source` is a defect of this requirement, not merely stale prose:
the proposal reader rejects `source` outright, so an agent following its own guidance would author a call the
backend refuses. This is the one consumer with no compile-time or test-time coupling to the wire shape, so the
requirement is stated in terms of the rendered text rather than in terms of a passing test.

#### Scenario: Each propose_* input schema exposes a decodable worked example
- **WHEN** the `examples` array of each `propose_*` tool's `inputSchema` is read and each entry is decoded via the
  same spray-json conversion `AssistantToolExecutor` applies to a real call of that tool
- **THEN** every entry decodes successfully to the tool's proposal type (`DashboardProposal`, `PipelineProposal`,
  `CombinedProposal`, or `PatchSet`) with no `DeserializationException`

#### Scenario: The pipeline and combined examples carry roots, not a singular source
- **WHEN** `propose_pipeline`'s and `propose_combined`'s schema examples are read
- **THEN** each carries a non-empty `roots` array and no `source` key, and each still decodes to its
  proposal type — the decode alone is not sufficient evidence, because a stale example that failed to
  decode and a stale example that decoded would both be defects

#### Scenario: The combined example exercises the pipeline-output sentinel
- **WHEN** `propose_combined`'s schema example is inspected and decoded
- **THEN** at least one dashboard panel in the example binds via the literal sentinel `"$pipelineOutput"` in place
  of a real outputId, and the example still decodes to a `CombinedProposal`

#### Scenario: The system prompt's shaping guidance is present and placeholder-safe
- **WHEN** `AssistantSystemPrompt.text` is inspected
- **THEN** it contains a worked-example/shaping section that shows well-formed `propose_*` call structure and an
  explicit statement that example ids are placeholders and real ids must come from `find`/`get_resource` results

#### Scenario: The system prompt describes roots, per-root branch exclusivity, and parentId
- **WHEN** `AssistantSystemPrompt.text` is rendered and read
- **THEN** its pipeline guidance describes a `roots` array whose branch exclusivity is stated per root, its
  `test_connection` guidance requires a successful test for every inline `rest_api`/`sql` root rather than for
  "the source", and its `propose_patch_set` guidance describes `target.parentId` alongside `target.kind`/`id`

#### Scenario: The rendered prompt names no singular source shape
- **WHEN** `AssistantSystemPrompt.text` is rendered and searched
- **THEN** it contains no instruction describing a proposal's source as a single object

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

### Requirement: An inline REST/SQL source must be connection-tested before its proposal finalizes
`AssistantToolExecutor` SHALL reject (as an `isError` tool_result, not raise an exception) a
`propose_pipeline` or `propose_combined` call carrying **any** inline (non-`sourceId`) `rest_api` or
`sql` root, unless a `test_connection` call earlier in the same turn returned `ok = true` for a
config identical to that root's `config`. Every inline root SHALL be checked independently — a
verified first root does not exempt an unverified second. `sourceId`-referenced roots and inline
`csv`/`static` roots are exempt. A `test_connection` call SHALL dispatch to
`SourceService.testRest`/`testSql` (backed by `ConnectorDriver.testConnection`/`ConnectionTest.run`) for
the discriminated `type`/`config` payload it is given, and only a successful (`ok = true`) result
marks that exact config as verified for the remainder of the turn.

#### Scenario: An untested inline REST source is rejected, not finalized
- **WHEN** `propose_pipeline` is called with an inline `rest_api` root whose config was never
  passed to a successful `test_connection` call earlier in the same turn
- **THEN** the tool result is an `isError` result naming the untested root, and no proposal is finalized

#### Scenario: An untested second inline root is rejected even when the first was verified
- **WHEN** `propose_pipeline` is called with two inline `rest_api` roots, only the first of which was
  connection-tested successfully earlier in the same turn
- **THEN** the tool result is an `isError` result naming the second root, and no proposal is finalized

#### Scenario: Every inline root tested successfully finalizes the proposal
- **WHEN** `propose_pipeline` is called with two inline `sql` roots, each of whose configs returned
  `ok = true` from a `test_connection` call earlier in the same turn
- **THEN** the proposal is finalized

#### Scenario: A verified inline REST source proceeds to validation normally
- **WHEN** `test_connection` is called with an inline REST config and returns `ok = true`, and a
  subsequent `propose_pipeline` call in the same turn carries a root with the identical config
- **THEN** `propose_pipeline` proceeds to `PipelineProposalService.validate` exactly as before this
  change, unaffected by the new gate

#### Scenario: A failed test_connection does not verify the config
- **WHEN** `test_connection` is called with a config that resolves to `ok = false` (e.g. DNS
  failure), and a subsequent `propose_pipeline` call in the same turn carries a root with that same
  config
- **THEN** `propose_pipeline` is still rejected as unverified — a failed test never marks the config
  verified

#### Scenario: An edited config after verification is treated as unverified
- **WHEN** `test_connection` verifies a config, and a subsequent `propose_pipeline` call in the same
  turn carries a root whose config differs from the verified one in any field
- **THEN** `propose_pipeline` is rejected as unverified — verification is by exact config equality,
  never a fuzzy/partial match

#### Scenario: propose_combined applies the identical gate to its nested pipeline source
- **WHEN** `propose_combined` is called with an inline `rest_api`/`sql` root in `pipeline.roots`
  whose config was never verified earlier in the same turn
- **THEN** the call resolves to an `isError` tool_result asking for `test_connection` first, and no
  `AssistantProposal` is captured

#### Scenario: sourceId and inline csv/static sources are exempt from the gate
- **WHEN** `propose_pipeline` is called with a `sourceId`-referenced root, or an inline `csv` or
  `static` root
- **THEN** the call proceeds to `PipelineProposalService.validate` without requiring any
  `test_connection` call

### Requirement: Assistant Output-config surfaces document the known-key set
Every in-app assistant surface that lets Claude write an Output's `config` SHALL carry, in the text Claude sees, the
per-kind known config keys and the chart `{ groupBy, agg, yField }` / metric `{ agg }` or `{ value, agg }` aggregation
shapes, rendered from the same key table the backend validator enforces (one source, so prompt and validator cannot
drift). The surfaces are: the pipeline-proposal Output `config` schema (`propose_pipeline` / `propose_combined`), the
`propose_patch_set` tool's Output-edit `patch` description, and the `/api/refinements` Output-edit instructions.

#### Scenario: Every surface lists every kind's keys
- **WHEN** the pipeline-proposal Output config schema, the `propose_patch_set` patch description and the refinement
  Output-edit text are rendered
- **THEN** each contains every Output kind's known config keys and both aggregation shapes

#### Scenario: Prompt follows the validator
- **WHEN** a key is added to or removed from the validator's per-kind key table
- **THEN** all three surfaces change accordingly with no separate edit

### Requirement: Worked examples put Output config on the Output
Every `propose_*` worked example SHALL bind an `output`-type dashboard panel by `outputId` alone: no output panel in
an example SHALL carry a key that is an Output config key in `OutputConfigValidation.KnownKeys` (for example
`aggregation`, `fieldMapping`, `label`, `unit`, `chartType`), because the proposal apply path ignores those on a panel.
Every Output an example proposes, and every Output `config` an example patch carries, SHALL pass
`OutputConfigValidation` for its kind. At least one example SHALL show `aggregation` on an Output's `config`. This is
asserted by a test that derives the forbidden and allowed key sets from `KnownKeys`, never from a hand-copied list.

#### Scenario: An output panel in an example carries no Output config key
- **WHEN** every `output`-type panel in every `propose_*` tool's `examples` is inspected
- **THEN** none of its keys is in the union of `OutputConfigValidation.KnownKeys` values

#### Scenario: Example Output configs pass the validator
- **WHEN** every Output in every `propose_*` example (pipeline outputs, combined pipeline outputs, Output-targeted
  patch-set edits) is validated with `OutputConfigValidation` for its kind
- **THEN** each passes, and at least one of them carries a non-null `aggregation`

#### Scenario: Reintroducing a panel-level aggregation fails the test
- **WHEN** an `aggregation` key is added back to an output panel in a dashboard example
- **THEN** the example test fails naming the offending key

### Requirement: Strict authoring tool schemas
The assistant's propose tool schemas SHALL enumerate the authorable step types from the step registry, give per-op
config schemas for the common ops with `additionalProperties: false`, and document the compute expression grammar with
examples; a test SHALL fail when the enum or a per-op schema's required keys drift from the registry.

#### Scenario: Registry parity
- **WHEN** a step kind is authorable in the registry
- **THEN** it appears in the propose tool's step-type enum

### Requirement: Propose-time errors name the valid options
Pipeline proposal validation SHALL reject an unknown step type listing the valid types, a step missing required config
(e.g. an empty lookup config) naming the missing keys, and an Output id used as a root with an error stating that
Outputs are not data sources and naming the Output's pipeline.

#### Scenario: Output used as a root
- **WHEN** a proposal root's sourceId is the id of an Output the caller can read
- **THEN** validation fails with an error naming it as an Output and naming its pipeline id

#### Scenario: Empty lookup config
- **WHEN** a proposal has a lookup step with `config: {}`
- **THEN** validation fails naming the missing lookup keys

### Requirement: One proposal per model response
When one model response contains more than one `propose_*` tool call, the tool loop SHALL execute only the first in
response block order and return an error result for each later one telling the model that a turn yields one proposal
carrying every edit; a `propose_*` call in a later response of the same turn SHALL execute normally.

#### Scenario: Four parallel proposals
- **WHEN** a response contains four propose_pipeline calls
- **THEN** one is executed and three return the one-proposal-per-response error

#### Scenario: Corrected proposal in the next hop
- **WHEN** a propose call fails in one response and the next response contains one corrected propose call
- **THEN** the corrected call is executed

### Requirement: The assistant system prompt is sent in the system field on every turn
`AssistantService.converse` SHALL pass `AssistantSystemPrompt.text` as the `ClaudeToolRequest.system` prompt on
every call, whether `history` is empty or not, and SHALL NOT fold it into any message. The history `converse`
returns (and therefore what `AssistantConversationRoutes` persists and the UI renders) SHALL never contain the
system prompt text. A conversation persisted before this change (turn 1 stored as the plain user message) SHALL
receive the system prompt on its next turn with no data migration.

#### Scenario: A turn-2 request carries the system prompt
- **WHEN** `converse` is called once with empty history, and then again with the history the first call returned
- **THEN** the serialized outbound request of the second call has a top-level `system` field whose text equals
  `AssistantSystemPrompt.text`, byte-identical to the first call's `system` field

#### Scenario: No message carries the system prompt
- **WHEN** any `converse` call's outbound request is serialized
- **THEN** no entry of its `messages` array contains `AssistantSystemPrompt.text`

#### Scenario: The persisted transcript never shows the system prompt
- **WHEN** two messages are sent through the conversation converse route and the conversation is read back
- **THEN** no persisted turn contains `AssistantSystemPrompt.text`, and turn 1 is the plain user message

#### Scenario: A legacy conversation gets the system prompt on its next turn
- **WHEN** `converse` is called with a non-empty history whose turn 1 is a plain user message (the shape persisted
  before this change)
- **THEN** the outbound request carries `system` equal to `AssistantSystemPrompt.text`

### Requirement: The persisted conversation never carries model-internal blocks or empty text
The turns `converse` returns for persistence SHALL contain no thinking, redacted-thinking or unrecognised blocks and
no empty text blocks, and SHALL keep exactly one returned turn per turn of the full history, so the caller's
slicing by prior history length is unchanged. The conversation view SHALL render no message bubble for an empty or
whitespace-only text block, including in conversations saved before this rule.

#### Scenario: Two-turn conversation on a thinking model
- **WHEN** turn 1's response is a thinking block (empty `thinking`, a signature) then text, and the user sends a
  second message
- **THEN** the persisted assistant turn holds only the text block
- **AND** the second turn's request contains no thinking block from turn 1 and no empty text block

#### Scenario: Legacy empty bubble
- **WHEN** a saved transcript holds an assistant text block with empty text
- **THEN** the conversation view shows no bubble for it

### Requirement: A no-answer turn surfaces as an error and persists nothing
When the tool-use loop ends with a no-answer failure, or ends with a final response (not a hop-budget stop) that
has no visible answer text while no proposal was captured in that turn, `converse` SHALL fail with an
error message naming the cause. A refusal SHALL say Claude declined the request and name the category or
"unspecified". Any other no-answer SHALL name the stop reason. No turn SHALL be persisted.

#### Scenario: Refusal on the assistant route
- **WHEN** the model refuses a converse message
- **THEN** the route responds with an error whose message says Claude declined the request
- **AND** the conversation transcript is unchanged

#### Scenario: Proposal then an empty end_turn
- **WHEN** a turn calls a propose tool that validates and the next hop ends the turn with empty content
- **THEN** the turn succeeds, the persisted transcript holds the proposal's tool_use and tool_result
- **AND** the next converse request contains no empty message

### Requirement: Every converse request ends with a user turn
Every request `converse` sends SHALL end with a user message, so no request is an assistant prefill.

#### Scenario: Continued conversation with a dangling tool_use
- **WHEN** the persisted history ends with an assistant turn holding an unexecuted `tool_use`
- **THEN** the request's last message has role `user`

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
