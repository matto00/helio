# claude-api-client delta — assistant-prompt-caching

## ADDED Requirements

### Requirement: Outbound requests carry prompt-cache breakpoints on the stable prefix
Outbound Anthropic Messages API requests SHALL mark the stable prompt prefix with
`"cache_control": {"type": "ephemeral"}` breakpoints: for the tool-use path (`sendTool`), on the
last element of the `tools` array and on the last content block of the first message; for the
non-tool path (`send`/`stream`), on the first message (its string content written as an equivalent
one-element `text` block array to carry the marker). Wire models and writers SHALL default to no
marker, and any request that sets no marker SHALL serialize byte-identically to its
pre-cache-support form.

#### Scenario: sendTool marks the tools array and the first turn
- **WHEN** a `ClaudeApiToolRequest` with a non-empty `tools` array and a non-empty message history
  is built and serialized for `sendTool`
- **THEN** the serialized JSON carries `"cache_control": {"type": "ephemeral"}` on the last `tools`
  element and on the last content block of the first message, and on no other element

#### Scenario: send marks the system-prompt-carrying first message
- **WHEN** a `ClaudeApiRequest` with a non-empty message list is built and serialized for `send`
- **THEN** the first message's content is serialized as a one-element `text` block array whose
  block carries `"cache_control": {"type": "ephemeral"}`, and later messages are plain strings

#### Scenario: Unmarked requests serialize unchanged
- **WHEN** a wire request is serialized with every `cacheControl` field left at its `None` default
- **THEN** the produced JSON is byte-identical to the serialization before cache support existed

## MODIFIED Requirements

### Requirement: Existing single-shot send and stream are unaffected
Adding `sendWithTools` SHALL NOT change the request/response shape, behavior, or guardrail
semantics of `ClaudeClient.send` or `ClaudeClient.stream`, and SHALL NOT modify
`ClaudeApiMessage`/`ClaudeApiRequest`'s existing fields. Prompt-cache support supersedes the
"unmodified" guarantee in exactly one additive way: every built `send`/`stream` request with a
non-empty message list carries the first-message `cacheControl` marker (see "Outbound requests
carry prompt-cache breakpoints on the stable prefix"), and `ClaudeApiMessage` gains that one
default-`None` field. Pre-existing fields SHALL keep their exact meaning and serialization.

#### Scenario: send's existing behavior is unchanged
- **WHEN** the existing `ClaudeClientSpec` suite for `send`/`stream` is run after prompt-cache
  support lands
- **THEN** every test passes, with the sole permitted modification that expected built requests
  now carry the first-message cache marker — no other expectation changes

### Requirement: Token usage is returned for cost logging
On a successful `send`, `ClaudeResponse` SHALL expose `usage: TokenUsage(inputTokens,
outputTokens, cacheCreationInputTokens, cacheReadInputTokens)` populated from the Anthropic API
response's own `usage` field — never from the pre-flight estimate. The cache-token counters SHALL
parse `cache_creation_input_tokens`/`cache_read_input_tokens` tolerantly, defaulting to 0 when the
API omits them, and the tool-use loop SHALL aggregate all four counters across hops into the
outcome's `TokenUsage`.

#### Scenario: Usage reflects the API response, not the estimate
- **WHEN** a stub transport returns a response whose `usage` differs from the pre-flight estimated
  input token count
- **THEN** `ClaudeResponse.usage` equals the transport response's `usage`, not the estimate

#### Scenario: Cache counters absent from the API response default to zero
- **WHEN** a transport response's `usage` object carries no `cache_creation_input_tokens` or
  `cache_read_input_tokens` fields
- **THEN** the parsed usage exposes 0 for both cache counters and parsing does not fail

#### Scenario: Cache counters aggregate across tool-loop hops
- **WHEN** `sendWithTools` completes a multi-hop loop whose per-hop API responses carry nonzero
  `cache_read_input_tokens`
- **THEN** the outcome's `TokenUsage.cacheReadInputTokens` equals the sum across all hops
