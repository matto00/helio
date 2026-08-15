## MODIFIED Requirements

### Requirement: A failed tool execution is fed back to Claude, not raised as an exception
`sendWithTools` SHALL feed a failed tool execution back to Claude as an `isError` tool_result
rather than failing the overall `Future`, regardless of HOW that failure manifests: an explicit
`Left(message)` from the injected `ClaudeToolExecutor`, a thrown exception during `execute`, or a
failed inner `Future` the executor returns — every case becomes an `isError = true` tool_result,
and the loop continues (consuming one hop), never propagating as a failed `sendWithTools` `Future`.
A recovered thrown/failed-`Future` exception SHALL be logged at `warn` before being converted, so a
genuine programming-error bug in an executor stays observable rather than silently masked.

#### Scenario: A tool execution error is fed back and the loop continues
- **WHEN** the executor resolves a `tool_use` block to `Left("resource not found")` and the
  transport's next scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered),
  and the outbound `tool_result` block for that hop carries `isError = true`

#### Scenario: A thrown exception during tool execution is fed back, not raised
- **WHEN** the executor's `execute` throws an exception (rather than returning `Left`) for a
  `tool_use` block, and the transport's next scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered), the
  outbound `tool_result` block for that hop carries `isError = true`, and the exception is logged

#### Scenario: A failed inner Future from tool execution is fed back, not raised
- **WHEN** the executor's `execute` returns a failed `Future` (rather than `Future.successful(Left(_))`)
  for a `tool_use` block, and the transport's next scripted response contains only a final text
  block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered), and
  the outbound `tool_result` block for that hop carries `isError = true`
