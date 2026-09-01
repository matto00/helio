## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

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

### Requirement: A bounded 7-tool conversational loop answers a goal
`AssistantService.converse(history, message, user)` SHALL run `ClaudeClient.sendWithTools` with the tool
set `[find, get_resource, test_connection, propose_dashboard, propose_pipeline, propose_combined,
propose_patch_set]`, `webSearch = true` (Anthropic's server-side `web_search` tool — offered on every
call, unconditionally, never gated on message content or intent), and `maxHops = 4`, returning an
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
  unchanged, and the web_search call does not count against `maxHops`
