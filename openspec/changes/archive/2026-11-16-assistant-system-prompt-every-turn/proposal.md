## Why

The assistant's system prompt (`AssistantSystemPrompt.text`) reaches Claude only on a conversation's first
message. `AssistantService.seedHistory` folds it into turn 1 when `history` is empty, and `desanitizeFirstTurn`
strips it before persistence, so every later `converse` call runs with no tool guidance, no worked examples and no
rules. The request prefix also changes between turn 1 and turn 2, which breaks prompt caching and would break
thinking-signature round trips (HEL-1636).

## What Changes

- `ClaudeToolRequest` gains an optional `system` prompt; `ClaudeApiToolRequest` gains a `system` block list that
  serializes as the Messages API's top-level `system` array only when non-empty (absent = byte-identical JSON).
- The system block carries a `cache_control: ephemeral` breakpoint, so tools + system form a stable cached prefix.
- The tool-loop input-token guardrail counts the system prompt on every hop.
- `AssistantService.converse` passes `AssistantSystemPrompt.text` as `system` on every call, and no longer folds it
  into any message. `desanitizeFirstTurn` is removed: nothing is folded, so nothing needs undoing.
- Persisted transcripts are unchanged in shape: they already never contained the prompt.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `claude-api-client`: tool-use requests may carry a `system` prompt; the cache-breakpoint requirement adds the
  system block.
- `assistant-conversation-loop`: the assistant prompt is sent in `system` on every turn and never in a message.

## Impact

Backend only: `infrastructure/ai/ClaudeModels.scala`, `ClaudeWireModels.scala`, `ClaudeProtocol.scala`,
`ClaudeClient.scala`, `services/assistant/AssistantService.scala`, and their specs. No schema, route, frontend or
migration change. The non-tool `send`/`stream` path is untouched.

## Non-goals

- `RefinementService` / `DashboardAuthoringService` prompt placement (they use `send`/`stream`, not the tool loop).
- Keeping thinking blocks across turns (HEL-1636's territory).
- Any live Anthropic call (the local key is expired).
