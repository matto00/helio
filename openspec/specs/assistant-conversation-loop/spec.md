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
A `get_resource` tool call for `resourceType == DataType` SHALL include the DataType's
`PanelCapabilitiesResponse` (bindable panel kinds, required/optional slots) in its tool_result
payload as a distinct nested key alongside (never flat-field-unioned with) the existing DataType
detail, so Claude has the same bindable-panel-kind grounding `DashboardAuthoringService` injects
into its own prompt today, without requiring a second tool call and without either payload's own
`columns` field silently overwriting the other's.

#### Scenario: get_resource on a DataType returns both detail and capability grounding, uncollided
- **WHEN** `get_resource` is called for an owned DataType's id
- **THEN** the tool_result payload nests the DataType's detail (columns/sample rows/stats) and its
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
`"$pipelineOutput"` sentinel, the `propose_patch_set` `target`/`op`/`patch` shape, and pipeline source
existing-vs-inline branch exclusivity. Example resource ids SHALL be obviously-synthetic placeholders, and the
guidance SHALL state explicitly that real calls must only use ids returned by `find`/`get_resource` — the examples
must reinforce, never weaken, the existing never-fabricate-ids rule.

#### Scenario: Each propose_* input schema exposes a decodable worked example
- **WHEN** the `examples` array of each `propose_*` tool's `inputSchema` is read and each entry is decoded via the
  same spray-json conversion `AssistantToolExecutor` applies to a real call of that tool
- **THEN** every entry decodes successfully to the tool's proposal type (`DashboardProposal`, `PipelineProposal`,
  `CombinedProposal`, or `PatchSet`) with no `DeserializationException`

#### Scenario: The combined example exercises the pipeline-output sentinel
- **WHEN** `propose_combined`'s schema example is inspected and decoded
- **THEN** at least one dashboard panel in the example binds via the literal sentinel `"$pipelineOutput"` in place
  of a real dataTypeId, and the example still decodes to a `CombinedProposal`

#### Scenario: The system prompt's shaping guidance is present and placeholder-safe
- **WHEN** `AssistantSystemPrompt.text` is inspected
- **THEN** it contains a worked-example/shaping section that shows well-formed `propose_*` call structure and an
  explicit statement that example ids are placeholders and real ids must come from `find`/`get_resource` results

### Requirement: A bounded 7-tool conversational loop answers a goal
`AssistantService.converse(history, message, user)` SHALL run `ClaudeClient.sendWithTools` with the tool
set `[find, get_resource, test_connection, propose_dashboard, propose_pipeline, propose_combined,
propose_patch_set]`, `webSearch = true` (Anthropic's server-side `web_search` tool — offered on every
call, unconditionally, never gated on message content or intent), and `maxHops = 4`, returning an
`AssistantTurnResult` carrying the final text and, when a `propose_*` tool call validated successfully
during the turn, the structured proposal object it produced.

#### Scenario: A goal answerable from existing workspace data produces a DashboardProposal
- **WHEN** `converse` is called with a goal matching an existing DataType, and the scripted tool-use
  sequence resolves via `find` then a successful `propose_dashboard` call
- **THEN** the result's `proposal` is `Some(AssistantProposal.Dashboard(_))` carrying a
  `DashboardProposal` of the same quality `DashboardAuthoringService` would have produced

#### Scenario: A goal with no matching data falls back to propose_pipeline, with no special-case code
- **WHEN** `converse` is called with a goal for which `find` returns no matching DataType, and the
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
  unchanged, and the web_search call does not count against `maxHops`

### Requirement: The hop cap is 4, supplied by the caller
`AssistantService` SHALL pass `maxHops = 4` to `ClaudeToolRequest`, never relying on any default
inside `ClaudeClient`.

#### Scenario: A 5th tool_use attempt terminates gracefully via the existing hop-budget outcome
- **WHEN** the scripted tool-use sequence would require a 5th round trip
- **THEN** `converse`'s result reflects `ClaudeToolOutcome.HopBudgetExhausted` gracefully (no
  exception), consistent with HEL-660's existing hard-cap behavior

### Requirement: An inline REST/SQL source must be connection-tested before its proposal finalizes
`AssistantToolExecutor` SHALL reject (as an `isError` tool_result, not raise an exception) a
`propose_pipeline` or `propose_combined` call whose pipeline `source` is an inline (non-`sourceId`)
`rest_api` or `sql` source, unless a `test_connection` call earlier in the same turn returned
`ok = true` for a config identical to that source's `config`. `sourceId`-referenced sources and
inline `csv`/`static` sources are exempt. A `test_connection` call SHALL dispatch to
`SourceService.testRest`/`testSql` (backed by `ConnectorDriver.testConnection`/`ConnectionTest.run`) for
the discriminated `type`/`config` payload it is given, and only a successful (`ok = true`) result
marks that exact config as verified for the remainder of the turn.

#### Scenario: An untested inline REST source is rejected, not finalized
- **WHEN** `propose_pipeline` is called with an inline `rest_api` source whose config was never
  passed to a successful `test_connection` call earlier in the same turn
- **THEN** the call resolves to an `isError` tool_result asking for `test_connection` first, and no
  `AssistantProposal` is captured

#### Scenario: A verified inline REST source proceeds to validation normally
- **WHEN** `test_connection` is called with an inline REST config and returns `ok = true`, and a
  subsequent `propose_pipeline` call in the same turn carries an inline source with the identical
  config
- **THEN** `propose_pipeline` proceeds to `PipelineProposalService.validate` exactly as before this
  change, unaffected by the new gate

#### Scenario: A failed test_connection does not verify the config
- **WHEN** `test_connection` is called with a config that resolves to `ok = false` (e.g. DNS
  failure), and a subsequent `propose_pipeline` call in the same turn carries an inline source with
  that same config
- **THEN** `propose_pipeline` is still rejected as unverified — a failed test never marks the config
  verified

#### Scenario: An edited config after verification is treated as unverified
- **WHEN** `test_connection` verifies a config, and a subsequent `propose_pipeline` call in the same
  turn carries an inline source whose config differs from the verified one in any field
- **THEN** `propose_pipeline` is rejected as unverified — verification is by exact config equality,
  never a fuzzy/partial match

#### Scenario: propose_combined applies the identical gate to its nested pipeline source
- **WHEN** `propose_combined` is called with an inline `rest_api`/`sql` `pipeline.source` whose
  config was never verified earlier in the same turn
- **THEN** the call resolves to an `isError` tool_result asking for `test_connection` first, and no
  `AssistantProposal` is captured

#### Scenario: sourceId and inline csv/static sources are exempt from the gate
- **WHEN** `propose_pipeline` is called with a `sourceId`-referenced source, or an inline `csv` or
  `static` source
- **THEN** the call proceeds to `PipelineProposalService.validate` without requiring any
  `test_connection` call
