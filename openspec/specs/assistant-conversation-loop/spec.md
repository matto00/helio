# assistant-conversation-loop Specification

## Purpose
A bounded, 6-tool Claude conversation loop (`AssistantService.converse`) that answers a workspace
goal by searching (`find`/`get_resource`) and proposing (`propose_dashboard`/`propose_pipeline`/
`propose_combined`/`propose_patch_set`) — never applying, so a human always reviews before anything
is mutated — the core entry point HEL-659's top-level workspace assistant is built around.
## Requirements
### Requirement: A bounded 6-tool conversational loop answers a goal
`AssistantService.converse(history, message, user)` SHALL run `ClaudeClient.sendWithTools` with the tool
set `[find, get_resource, propose_dashboard, propose_pipeline, propose_combined, propose_patch_set]`
and `maxHops = 3`, returning an `AssistantTurnResult` carrying the final text and, when a `propose_*`
tool call validated successfully during the turn, the structured proposal object it produced.

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

### Requirement: The hop cap is 3, supplied by the caller
`AssistantService` SHALL pass `maxHops = 3` to `ClaudeToolRequest`, never relying on any default
inside `ClaudeClient`.

#### Scenario: A 4th tool_use attempt terminates gracefully via the existing hop-budget outcome
- **WHEN** the scripted tool-use sequence would require a 4th round trip
- **THEN** `converse`'s result reflects `ClaudeToolOutcome.HopBudgetExhausted` gracefully (no
  exception), consistent with HEL-660's existing hard-cap behavior

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

