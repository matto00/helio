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

### Requirement: The tool-loop-outcome record SHALL carry propose-call quality counters
The `assistant_tool_loop_outcome` telemetry record SHALL additionally carry three per-turn integer counters for the
turn's `propose_*` tool calls: total attempts (`proposeAttempts`), schema-decode failures
(`proposeDecodeFailures` — a `propose_*` input that failed spray-json conversion in `AssistantToolExecutor`), and
downstream validation failures (`proposeValidationFailures` — a decoded proposal whose validate/preview call returned
`Left`). Combined with the record's existing `modelId` field, these make propose-call shaping quality measurable per
model. The counters SHALL be counted at the failure site (the executor's `propose_*` dispatch paths), and the failing
tool input payload or its error text SHALL never be logged — only integer counts.

#### Scenario: A malformed propose call is counted as a decode failure
- **WHEN** a `POST /:id/converse` turn includes a `propose_*` tool call whose input fails spray-json decoding, and
  the turn completes successfully
- **THEN** the emitted record's `proposeDecodeFailures` is at least 1 and `proposeAttempts` counts that call

#### Scenario: A well-formed but semantically invalid proposal is counted as a validation failure
- **WHEN** a turn includes a `propose_*` call that decodes successfully but whose validate/preview call returns
  `Left`, and the turn completes successfully
- **THEN** the emitted record's `proposeValidationFailures` is at least 1 and `proposeDecodeFailures` does not count
  that call

#### Scenario: A clean propose call counts as an attempt with zero failures
- **WHEN** a turn's only `propose_*` call decodes and validates successfully
- **THEN** the emitted record carries `proposeAttempts` of 1, `proposeDecodeFailures` of 0, and
  `proposeValidationFailures` of 0

#### Scenario: The failing payload never reaches the log line
- **WHEN** any `assistant_tool_loop_outcome` record is emitted for a turn containing a failed `propose_*` call
- **THEN** the record contains no field carrying the failing tool input payload or its deserialization error text

