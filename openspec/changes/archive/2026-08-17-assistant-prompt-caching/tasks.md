# Tasks: assistant-prompt-caching

## 1. Backend — wire models and protocol

- [x] 1.1 Add `ClaudeApiCacheControl` (companion `Ephemeral`) and default-`None` `cacheControl` fields to `ClaudeApiContentBlock`, `ClaudeApiTool`, `ClaudeApiMessage` in `ClaudeWireModels.scala` (design.md D1)
- [x] 1.2 Extend `claudeApiContentBlockFormat.write` and `claudeApiToolFormat.write` to append `cache_control` when set; readers ignore it (design.md D2)
- [x] 1.3 Replace `claudeApiMessageFormat`'s `jsonFormat2` with a hand-written format: plain-string content when unmarked (byte-identical), one-element `text` block array carrying `cache_control` when marked (design.md D2)
- [x] 1.4 Add `cacheCreationInputTokens`/`cacheReadInputTokens` (default 0) to `ClaudeApiUsage`; parse `cache_creation_input_tokens`/`cache_read_input_tokens` absent-tolerantly and emit them in `claudeApiUsageFormat` (design.md D4)

## 2. Backend — client breakpoints and usage aggregation

- [x] 2.1 Mark breakpoints in `ClaudeClient.toApiToolRequest`: last `tools` element + last content block of the first message, each guarded on non-empty (design.md D3)
- [x] 2.2 Mark the first message in `ClaudeClient.toApiRequest` (shared by `send`/`stream`), guarded on non-empty (design.md D3)
- [x] 2.3 Add the two default-0 cache fields to domain `TokenUsage` (`ClaudeModels.scala`); sum all four counters in `addUsage`; map them in `toClaudeResponse` (design.md D4)

## 3. Backend — telemetry

- [x] 3.1 Append `cacheReadInputTokens`/`cacheCreationInputTokens` fields from `tokens` in `AssistantTelemetry.emitToolLoopOutcome` (design.md D5)

## 4. Tests

- [x] 4.1 `ClaudeProtocol` tests: `cache_control` emitted for marked block/tool/message, unmarked serialization byte-identical, usage parse with cache fields present and absent (spec: "Unmarked requests serialize unchanged", "Cache counters absent ... default to zero")
- [x] 4.2 `HttpClaudeTransportSpec`: serialized `sendTool` entity carries `cache_control` on the last tool and the first message's last block only; `send` entity carries the first-message block-array marker (spec: "sendTool marks the tools array and the first turn", "send marks the system-prompt-carrying first message")
- [x] 4.3 `ClaudeClient` tests (stub transport): breakpoint placement in built requests for both paths, incl. empty-tools/empty-messages guards; multi-hop cache-counter aggregation (spec: "Cache counters aggregate across tool-loop hops")
- [x] 4.4 `AssistantTelemetry`/`AssistantConversationRoutes` test coverage for the two new telemetry fields (spec: "A multi-hop turn's record shows nonzero cache reads" — driven via stubbed usage)
- [x] 4.5 Run `sbt test` for the backend suite plus frontend lint/test gates; confirm zero frontend/schema diffs
- [x] 4.6 Update `ClaudeClientSpec`'s "wire model/max-tokens/temperature/messages through to the transport request" expected `ClaudeApiRequest` to carry the first-message cache marker — the suite's only full-request exact-equality fixture (spec: "send's existing behavior is unchanged" MODIFIED scenario; skeptic-design-1.md CR1)
