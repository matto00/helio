## MODIFIED Requirements

### Requirement: The existing input-token guardrail applies to every hop of the tool-use loop
`sendWithTools` SHALL run the same pre-flight input-token estimate `send` already runs before each
hop's outbound call (not only the first). When the estimate exceeds `ClaudeConfig.maxInputTokens`
mid-loop, it SHALL resolve to `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))` without
issuing that hop's transport call, unless the caller opted in to a clean input-budget stop. With that opt-in and at
least one hop already run, it SHALL instead resolve to an input-budget-exhausted outcome carrying the history built
so far (ending with the last hop's tool results), the summed usage, the hops used and the failed-call count, again
without issuing that hop's transport call. The first hop SHALL always resolve to
`Failed(GuardrailExceeded(_))` with zero transport calls, opt-in or not.

#### Scenario: A mid-loop guardrail rejection stops the loop without a further transport call
- **GIVEN** a hop's accumulated history estimate exceeds `ClaudeConfig.maxInputTokens`, and the caller did not opt
  in to the clean input-budget stop
- **WHEN** `sendWithTools` would otherwise issue that hop's request
- **THEN** it resolves to `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))` and the
  transport records no invocation for that hop

#### Scenario: Opted-in caller gets a clean stop with the work so far
- **GIVEN** the caller opted in, one hop has run, and the second hop's estimate exceeds the limit
- **WHEN** `sendWithTools` would otherwise issue the second hop's request
- **THEN** it resolves to the input-budget-exhausted outcome whose history holds the first hop's tool use and tool
  results, and the transport was invoked exactly once

#### Scenario: Opted-in caller over the limit on the first hop is still refused
- **GIVEN** the caller opted in and the very first request's estimate exceeds the limit
- **WHEN** `sendWithTools` is called
- **THEN** it resolves to `Failed(GuardrailExceeded(_))` and the transport is never invoked

## ADDED Requirements

### Requirement: A caller can bound the tool-use loop by failed tool calls
`ClaudeToolRequest` SHALL accept an optional, caller-supplied failure budget: a maximum number of failed tool calls
and a classifier that, given an executed `tool_use` and its `tool_result`, returns the failure's message or nothing
when the call did not fail. The classifier SHALL be applied only to calls the loop dispatched to the caller's
executor, never to a call rejected without running under the once-per-response rule. Failures SHALL be counted in
total across the loop. After every result of a round trip has been collected, when the count has reached the maximum
the loop SHALL stop without a further transport call and resolve a failure-budget-exhausted outcome carrying the
history (ending with that round trip's tool results), the summed usage, the hops used and the failed calls (tool
name and message, in order). The failure-budget check SHALL run before the hop-cap check of the next round trip, so
a third failure on the last allowed round trip is a failure-budget stop. Without a failure budget the loop SHALL
behave exactly as before. Every outcome that carries history SHALL also expose the hops used and the number of
failed calls counted.

#### Scenario: The Nth failure stops the loop after its round trip
- **GIVEN** a failure budget of 3 and scripted responses that each request one tool whose execution fails
- **WHEN** `sendWithTools` is called
- **THEN** the executor is invoked exactly 3 times, the transport exactly 3 times, and the outcome is
  failure-budget-exhausted with 3 failed calls

#### Scenario: Successes do not reset the count
- **GIVEN** a failure budget of 3 and round trips alternating a failing call and a succeeding call
- **WHEN** `sendWithTools` is called
- **THEN** the loop stops after the round trip that produced the third failure

#### Scenario: Once-per-response rejections are not classified
- **GIVEN** a failure budget of 3 and one response with four calls of a once-per-response tool, the first of which
  succeeds
- **WHEN** that round trip completes
- **THEN** the failed-call count is 0

#### Scenario: Parallel calls in the stopping round trip all return results
- **GIVEN** 2 failures counted and a response requesting three calls, the first of which fails
- **WHEN** that round trip runs
- **THEN** all three calls execute, the history ends with a user turn holding all three results, and the loop stops

#### Scenario: No failure budget keeps the old behaviour
- **GIVEN** no failure budget and four consecutive failing calls within `maxHops`
- **WHEN** `sendWithTools` is called
- **THEN** every call's failure is fed back and the loop continues until a final response or the hop cap
