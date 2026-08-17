## ADDED Requirements

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
