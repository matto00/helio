## ADDED Requirements

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
