# assistant-tool-loop-telemetry Specification

## Purpose
Structured, privacy-safe per-turn telemetry for HEL-659's assistant tool loop (tool-call count,
hop-cap-hit, no-results), mirroring `authoring-error-telemetry`'s log-line pattern for the newer
conversational flow.
## Requirements
### Requirement: Every completed assistant turn SHALL emit a structured, privacy-safe telemetry record
The backend SHALL emit one structured JSON log line (HEL-115 format, carrying trace context) per
successful `POST /:id/converse` call, recording the conversation id, tool-call count for that turn,
whether the hop cap was hit, whether the turn searched with no results, the model id, and real
token usage — including the prompt-cache counters `cacheReadInputTokens` and
`cacheCreationInputTokens` aggregated across the turn's hops — never the user's typed message text.

#### Scenario: A completed turn emits a tool-loop-outcome record
- **WHEN** `POST /:id/converse` completes successfully
- **THEN** a telemetry log line with event `assistant_tool_loop_outcome` is emitted, recording
  `toolCallCount`, `hopBudgetExhausted`, `searchedWithNoResults`, `modelId`, and token usage
  including `cacheReadInputTokens` and `cacheCreationInputTokens`

#### Scenario: A hop-cap-exhausted turn's record reflects it
- **WHEN** `POST /:id/converse` completes with `AssistantTurnResult.hopBudgetExhausted == true`
- **THEN** the emitted telemetry record's `hopBudgetExhausted` field is `true`

#### Scenario: The user's message text is never recorded
- **WHEN** any `assistant_tool_loop_outcome` telemetry log line is emitted for a `/converse` call
- **THEN** the log line contains no field carrying the raw message text the user typed

#### Scenario: A multi-hop turn's record shows nonzero cache reads
- **WHEN** `POST /:id/converse` completes a turn whose loop ran 2 or more hops and the API reported
  cache reads for the repeated prefix
- **THEN** the emitted record's `cacheReadInputTokens` field is nonzero

### Requirement: A failed converse call SHALL NOT emit a tool-loop-outcome record
Telemetry emission SHALL be conditioned on `AssistantService.converse` returning `Right` — a
`Left(ClaudeError)` result (already mapped to an error response, nothing persisted) SHALL NOT emit
an `assistant_tool_loop_outcome` record, since no turn actually completed.

#### Scenario: A failed converse call emits nothing
- **WHEN** `POST /:id/converse` fails because `AssistantService.converse` resolves to
  `Left(ClaudeError)`
- **THEN** no `assistant_tool_loop_outcome` telemetry log line is emitted for that call

