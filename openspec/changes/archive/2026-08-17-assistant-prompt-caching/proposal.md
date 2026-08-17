# Proposal: assistant-prompt-caching

## Why

The assistant's tool-use loop (`AssistantService`, up to 3 hops per `/converse` turn) re-sends the entire accumulated
history, the full `tools` array, and the folded-in system prompt on every hop — a large, byte-stable, fully-repeated
prefix on hops 2/3 that Anthropic prompt caching could serve at ~10% of input cost. The wire layer
(`ClaudeWireModels`/`ClaudeProtocol`) currently has zero `cache_control` support, so none of that repetition is cached.

## What Changes

- Wire models gain an optional, default-`None` cache-control marker: `ClaudeApiContentBlock`, `ClaudeApiTool`, and
  `ClaudeApiMessage`, serialized as `"cache_control": {"type": "ephemeral"}` by the hand-written spray-json writers.
  Every existing construction site compiles and serializes byte-identically when unset.
- `ClaudeClient`'s request builders mark the stable prefix: `toApiToolRequest` (the `sendTool` path) marks the last
  tool of the `tools` array and the last block of the first message; `toApiRequest` (the `send`/`stream` path) marks
  the first message.
- `ClaudeApiUsage` and domain `TokenUsage` gain `cacheCreationInputTokens`/`cacheReadInputTokens` (default 0,
  absent-tolerant parse), aggregated across hops by `ClaudeClient.addUsage`.
- `AssistantTelemetry.emitToolLoopOutcome` logs the two new cache-token fields so the cache-hit rate and realized
  savings are verifiable post-deploy.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `claude-api-client`: new requirement — outbound requests carry prompt-cache breakpoints on the stable prefix;
  modified requirement — token usage reported for cost logging now includes cache read/creation input tokens.
- `assistant-tool-loop-telemetry`: modified requirement — the per-turn telemetry record additionally carries
  `cacheReadInputTokens`/`cacheCreationInputTokens`.

## Impact

- Backend only: `com.helio.ai` (`ClaudeWireModels`, `ClaudeProtocol`, `ClaudeClient`, `ClaudeModels`) and
  `com.helio.services.AssistantTelemetry`. No schema, frontend, database, or migration impact — `TokenUsage` has no
  spray formatter and never reaches an HTTP response (verified; it feeds telemetry only).
- Conversation behavior/output is unchanged — purely a cost optimization plus observability.

## Non-goals

- No incremental per-hop history breakpoints (marking the newest turn each hop); scope is the ticket's two stable
  breakpoints. Possible follow-up if telemetry shows deep-history turns missing the cache.
- No `AuthoringTelemetry` extension for the `send` path — cache tokens flow into `TokenUsage` regardless.
- No configuration knob to toggle caching; it is unconditional, matching the ticket's "zero behavior change" framing.
- No frontend surfacing of cache metrics.
