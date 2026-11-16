## MODIFIED Requirements

### Requirement: Outbound requests carry prompt-cache breakpoints on the stable prefix
Outbound Anthropic Messages API requests SHALL mark the stable prompt prefix with
`"cache_control": {"type": "ephemeral"}` breakpoints: for the tool-use path (`sendTool`), on the
last element of the `tools` array, on the last block of the top-level `system` array when the request
carries a system prompt, and on the last content block of the first message; for the
non-tool path (`send`/`stream`), on the first message (its string content written as an equivalent
one-element `text` block array to carry the marker). Wire models and writers SHALL default to no
marker, and any request that sets no marker SHALL serialize byte-identically to its
pre-cache-support form.

#### Scenario: sendTool marks the tools array and the first turn
- **WHEN** a `ClaudeApiToolRequest` with a non-empty `tools` array, no system prompt and a non-empty message
  history is built and serialized for `sendTool`
- **THEN** the serialized JSON carries `"cache_control": {"type": "ephemeral"}` on the last `tools`
  element and on the last content block of the first message, and on no other element

#### Scenario: sendTool marks the system block when a system prompt is present
- **WHEN** a `ClaudeToolRequest` with a non-empty `system` prompt is built and serialized for `sendTool`
- **THEN** the serialized JSON's top-level `system` array's last block carries
  `"cache_control": {"type": "ephemeral"}`, in addition to the last-tool and first-message markers, and no other
  element carries one

#### Scenario: send marks the system-prompt-carrying first message
- **WHEN** a `ClaudeApiRequest` with a non-empty message list is built and serialized for `send`
- **THEN** the first message's content is serialized as a one-element `text` block array whose
  block carries `"cache_control": {"type": "ephemeral"}`, and later messages are plain strings

#### Scenario: Unmarked requests serialize unchanged
- **WHEN** a wire request is serialized with every `cacheControl` field left at its `None` default
- **THEN** the produced JSON is byte-identical to the serialization before cache support existed

## ADDED Requirements

### Requirement: A tool-use request can carry a system prompt in the API's system field
`ClaudeToolRequest` SHALL accept an optional `system` prompt. When it is present and non-empty, every hop of
`sendWithTools` SHALL send it as the Messages API's top-level `system` field (an array of one `text` block),
identical on every hop, and SHALL NOT place it in any message. When it is absent, the serialized request SHALL
contain no `system` key and be byte-identical to its form before this field existed. The pre-flight input-token
guardrail SHALL count the system prompt on every hop.

#### Scenario: Every hop carries the same system field
- **WHEN** `sendWithTools` runs a two-hop loop for a request with `system = Some(s)`
- **THEN** both outbound requests serialize a top-level `system` array whose single text block equals `s`, and no
  message content contains `s`

#### Scenario: No system prompt means no system key
- **WHEN** a `ClaudeApiToolRequest` with no system blocks is serialized
- **THEN** the JSON object has no `system` key

#### Scenario: The guardrail counts the system prompt
- **WHEN** a request's messages alone are under `ClaudeConfig.maxInputTokens` but messages plus `system` exceed it
- **THEN** `sendWithTools` resolves to `Failed(GuardrailExceeded(_))` with no transport call
