## ADDED Requirements

### Requirement: A bounded multi-turn tool-use loop is available
`ClaudeClient` SHALL expose `sendWithTools(request: ClaudeToolRequest, executor:
ClaudeToolExecutor): Future[ClaudeToolOutcome]`, where `ClaudeToolRequest` carries a message
history, a tool schema list, and a caller-supplied `maxHops` value. The loop SHALL: send the
current history and tools to the transport; when the response contains no `tool_use` content
block, return `ClaudeToolOutcome.FinalResponse`; when it contains one or more `tool_use` blocks
and the hop budget is not yet exhausted, invoke `executor` for each `tool_use` block, append a
`tool_result`-bearing turn to the history, and repeat.

#### Scenario: A single tool round-trip resolves to a final answer
- **WHEN** a fake transport's first scripted response contains a `tool_use` block and its second
  scripted response contains only a final text block
- **THEN** `sendWithTools` invokes the executor exactly once and resolves to
  `ClaudeToolOutcome.FinalResponse` carrying the second response's text

#### Scenario: A response with no tool_use resolves immediately, zero executor invocations
- **WHEN** a fake transport's first scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` without invoking the
  executor at all

### Requirement: The tool-use loop hard-caps at a caller-supplied hop count
`sendWithTools` SHALL NOT execute a `tool_use` block, and SHALL NOT issue a further request to the
transport, once `maxHops` round trips have already been used; it SHALL instead resolve to
`ClaudeToolOutcome.HopBudgetExhausted` carrying the accumulated history and usage. `maxHops` SHALL
be a parameter of `ClaudeToolRequest` supplied by the caller, never a value hardcoded inside
`ClaudeClient`.

#### Scenario: A 4th tool_use attempt terminates gracefully instead of looping again
- **GIVEN** `maxHops = 3` and a fake transport whose first four scripted responses each contain a
  `tool_use` block (fails/throws if invoked a 5th time)
- **WHEN** `sendWithTools` is called
- **THEN** the executor is invoked exactly 3 times, the transport is invoked exactly 4 times, and
  the result is `ClaudeToolOutcome.HopBudgetExhausted` — not an exception, not a 5th transport call

#### Scenario: Exactly at the hop budget still resolves normally
- **GIVEN** `maxHops = 3` and a fake transport whose first three scripted responses each contain a
  `tool_use` block and whose fourth scripted response contains only a final text block
- **WHEN** `sendWithTools` is called
- **THEN** the executor is invoked exactly 3 times and the result is
  `ClaudeToolOutcome.FinalResponse`

### Requirement: A failed tool execution is fed back to Claude, not raised as an exception
`sendWithTools` SHALL feed a failed tool execution back to Claude as an `isError` tool_result
rather than failing the overall `Future`: when the injected `ClaudeToolExecutor` resolves a
`tool_use` block to `Left(message)`, that message becomes a `tool_result` block with `isError =
true`, and the loop continues (consuming one hop).

#### Scenario: A tool execution error is fed back and the loop continues
- **WHEN** the executor resolves a `tool_use` block to `Left("resource not found")` and the
  transport's next scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered),
  and the outbound `tool_result` block for that hop carries `isError = true`

### Requirement: The existing input-token guardrail applies to every hop of the tool-use loop
`sendWithTools` SHALL run the same pre-flight input-token estimate `send` already runs before each
hop's outbound call (not only the first). When the estimate exceeds `ClaudeConfig.maxInputTokens`
mid-loop, it SHALL resolve to `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))` without
issuing that hop's transport call.

#### Scenario: A mid-loop guardrail rejection stops the loop without a further transport call
- **GIVEN** a hop's accumulated history estimate exceeds `ClaudeConfig.maxInputTokens`
- **WHEN** `sendWithTools` would otherwise issue that hop's request
- **THEN** it resolves to `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))` and the
  transport records no invocation for that hop

### Requirement: Token usage accumulates across every hop of the tool-use loop
`ClaudeToolOutcome.FinalResponse` and `ClaudeToolOutcome.HopBudgetExhausted` SHALL carry a
`TokenUsage` that sums `inputTokens`/`outputTokens` across every hop's transport response, not
just the final hop's.

#### Scenario: Usage sums across two hops
- **WHEN** a fake transport's first response (a `tool_use` hop) reports usage A and its second
  (final) response reports usage B
- **THEN** the resulting `ClaudeToolOutcome.FinalResponse.usage` equals the sum of A and B

### Requirement: Existing single-shot send and stream are unaffected
Adding `sendWithTools` SHALL NOT change the request/response shape, behavior, or guardrail
semantics of `ClaudeClient.send` or `ClaudeClient.stream`, and SHALL NOT modify
`ClaudeApiMessage`/`ClaudeApiRequest`'s existing fields.

#### Scenario: send's existing behavior is unchanged
- **WHEN** the existing `ClaudeClientSpec` suite for `send`/`stream` is run after this change
- **THEN** every existing test passes unmodified
