## Why

The workspace assistant's tool loop stops after 4 tool-executing round trips whether they succeeded or not, so a
productive multi-step turn (several finds, get_resource, test_connection, propose) is cut off just before it answers,
and the web client then shows a hardcoded "I couldn't find enough in 3 lookups" message that names neither the real
cap nor the cause. The owner wants the loop to budget failures, not progress.

## What Changes

- The assistant tool loop runs until the model answers, until **3 failed tool calls** in the turn (total, not
  consecutive), or until a hard ceiling of **12 tool-executing round trips** (owner ruling), whichever comes first.
- A failed tool call is an executed call whose result is an error (`isError`: unknown tool, bad input, decode or
  validation failure, a read that failed) or a `test_connection` whose result reports `ok: false`. The synthetic
  "only one propose_* per response" rejections (HEL-1639) and the synthetic results for a previous turn's unexecuted
  calls are not counted.
- When the failure budget is spent, the turn ends with a plain-language assistant message naming what failed (for
  example "I couldn't connect to the source after 3 tries"), persisted as the turn's final assistant message.
- When the ceiling is reached, the turn ends with a clear message that it stopped after 12 steps, replacing
  "Reached the maximum number of tool calls (4) without a final response" and the web client's "3 lookups" text.
- When the conversation outgrows the input-token limit part-way through a turn (after at least one hop ran), the
  turn ends cleanly with the work so far and a plain-language message instead of discarding the whole turn. A first
  request over the limit is still refused before sending, unchanged.
- The converse response gains `stopReason` (`final | failure_budget | hop_ceiling | input_budget`) and `stopMessage`;
  `hopBudgetExhausted` keeps its meaning (true only for the ceiling stop).
- The `assistant_tool_loop_outcome` telemetry record gains `hopsUsed`, `failedToolCalls` and `stopReason`.
- Unchanged and still tested: the per-turn web-search budget (`CLAUDE_WEB_SEARCH_MAX_USES`), one weighted beta
  daily-cap charge per turn (HEL-1755), and the input-token refusal before sending (`CLAUDE_MAX_INPUT_TOKENS`).
- Out of scope: the ask loop (HEL-1745), streaming (HEL-721).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `assistant-conversation-loop`: the hop cap of 4 is replaced by a 3-failure budget plus a 12-hop ceiling, with
  plain-language stop messages and a clean stop when the input-token limit is reached mid-turn.
- `assistant-tool-loop-telemetry`: the outcome record carries hops used, failed tool calls and the stop reason.
- `claude-api-client`: the tool-use loop gains an opt-in, caller-supplied failure budget and an opt-in clean stop
  when the input-token guardrail rejects a hop after the first; defaults unchanged.

## Impact

- Backend: `ClaudeClient.sendWithTools` / `ClaudeModels` (opt-in failure budget and mid-loop input stop on
  `ClaudeToolRequest`, new outcomes), `AssistantService`, `AssistantTelemetry`, `AssistantProtocol` /
  `AssistantConversationProtocol`, `AssistantConversationRoutes`; exhaustive matches on `ClaudeToolOutcome` in
  `AskDataService` and `ClaudeInsightClient` (behaviour unchanged).
- Contract: `schemas/assistant/assistant-conversation.schema.json` (two optional converse-only fields).
- Web client: `features/assistant` (types, slice, `ActiveConversationPanel`, `MessageTurn`) renders the stop
  message and a per-reason note.
- No migration, no new environment variable, no new dependency.
