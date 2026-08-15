## 1. Backend: Domain models

- [x] 1.1 Add `ClaudeContentBlock` (sealed: `Text`, `ToolUse(id, name, input: JsValue)`,
      `ToolResult(toolUseId, content, isError)`) to `ClaudeModels.scala`
- [x] 1.2 Add `ClaudeToolMessage(role, content: Seq[ClaudeContentBlock])` with a `.text(role,
      string)` convenience constructor
- [x] 1.3 Add `ClaudeTool(name, description, inputSchema: JsValue)`
- [x] 1.4 Add `ClaudeToolRequest(history, tools, maxHops, maxTokens = None, temperature = None)`
- [x] 1.5 Add `ClaudeToolExecutor` trait: `execute(name, input)(implicit ec): Future[Either[String,
      String]]`
- [x] 1.6 Add `ClaudeToolOutcome` (sealed: `FinalResponse(text, history, usage)`,
      `HopBudgetExhausted(history, usage)`, `Failed(error: ClaudeError)`)

## 2. Backend: Wire models + protocol

- [x] 2.1 Extend `ClaudeApiContentBlock` with optional `id`, `name`, `input: Option[JsValue]`,
      `toolUseId`, `isError` fields (default `None`); confirm no existing construction site breaks
- [x] 2.2 Add `ClaudeApiTool(name, description, inputSchema: JsValue)`
- [x] 2.3 Add `ClaudeApiToolMessage(role, content: Seq[ClaudeApiContentBlock])`
- [x] 2.4 Add `ClaudeApiToolRequest(model, maxTokens, messages: Seq[ClaudeApiToolMessage],
      temperature, tools: Seq[ClaudeApiTool])`
- [x] 2.5 Extend `claudeApiContentBlockFormat` in `ClaudeProtocol.scala` to read/write `tool_use`
      (`id`, `name`, `input`) and write `tool_result` (`tool_use_id`, `content`, `is_error`) block
      shapes, alongside the existing `text` block handling
- [x] 2.6 Add spray-json formatters for `ClaudeApiTool` (`input_schema` snake_case),
      `ClaudeApiToolMessage`, `ClaudeApiToolRequest` (outbound-only, matching `ClaudeApiRequest`'s
      existing pattern)

## 3. Backend: Transport + client loop

- [x] 3.1 Add `sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]` to
      `ClaudeTransport` trait **with a default implementation** that throws
      `UnsupportedOperationException` (mirrors `claudeApiRequestFormat.read`'s existing
      "outbound-only" pattern in `ClaudeProtocol.scala`) — required so the 5 pre-existing
      `FakeClaudeTransport` implementers in `AuthoringTelemetrySpec.scala`,
      `DashboardAuthoringRoutesSpec.scala`, `RefinementRoutesSpec.scala`,
      `DashboardAuthoringServiceSpec.scala`, `RefinementServiceSpec.scala` keep compiling
      untouched (design.md D4)
- [x] 3.2 Implement `HttpClaudeTransport.sendTool` (override) against the same `/v1/messages`
      endpoint as `send`, serializing `tools` + block-content messages
- [x] 3.3 Implement `ClaudeClient.sendWithTools(request: ClaudeToolRequest, executor:
      ClaudeToolExecutor): Future[ClaudeToolOutcome]`: pre-flight guardrail (reuse
      `guardrailReject`, approximating block content as flattened text for the estimate) → build
      `ClaudeApiToolRequest` from history/tools → `transport.sendTool` → map response content
      blocks to domain `ClaudeContentBlock`s
- [x] 3.4 Implement the hop loop: no `tool_use` in response → `FinalResponse`; `tool_use` present
      and hops remaining → execute each via `executor`, append `tool_result` turn (feed back
      `Left` as `isError = true`, per design D7), increment hop count, repeat; `tool_use` present
      and hop budget already exhausted → `HopBudgetExhausted`, no further transport call
- [x] 3.5 Accumulate `TokenUsage` across every hop's response into the final outcome
- [x] 3.6 Re-run the pre-flight guardrail before each hop's outbound call, not only the first;
      mid-loop rejection → `Failed(ClaudeError.GuardrailExceeded(_))`, no transport call for that
      hop
- [x] 3.7 Map transport/API failures at any hop to `Failed(ClaudeError.ApiError/TransportFailure)`,
      mirroring `send`'s existing error mapping

## 4. Tests

- [x] 4.1 Extend `ClaudeClientSpec`'s `FakeClaudeTransport` (or add a parallel fake) to support
      `sendTool` with a queue of scripted `ClaudeApiResponse`s, mirroring the "multiple queued
      responses" pattern already used by `DashboardAuthoringServiceSpec`
      (`Vector`-of-responses + invocation counter)
- [x] 4.2 Test: no `tool_use` in the first response → `FinalResponse`, zero executor invocations
- [x] 4.3 Test: one `tool_use` round trip → executor invoked once, `FinalResponse` on the second
      response
- [x] 4.4 Test: hard cap — 4 scripted `tool_use` responses with `maxHops = 3` → executor invoked
      exactly 3 times, transport invoked exactly 4 times, result is `HopBudgetExhausted`, no 5th
      transport call (fake throws on a 5th `sendTool` invocation, same style as HEL-392's bounded
      self-repair test)
- [x] 4.5 Test: exactly `maxHops` tool_use round trips followed by a final response →
      `FinalResponse`, not `HopBudgetExhausted`
- [x] 4.6 Test: executor returns `Left` → fed back as `isError = true` tool_result, loop continues
      to a `FinalResponse`
- [x] 4.7 Test: usage sums across hops
- [x] 4.8 Test: mid-loop guardrail rejection (second hop's estimated history exceeds
      `maxInputTokens`) → `Failed(GuardrailExceeded)`, no transport call for that hop
- [x] 4.9 Test: existing `ClaudeClientSpec` `send`/`stream` suite still passes unmodified
- [x] 4.10 Test: `HttpClaudeTransport.sendTool` serializes `tools` and block-content messages
      correctly (request-shape assertion, no real network call — same stub pattern as existing
      `HttpClaudeTransport` coverage)
