## Why

The assistant's REST-source proposals (base URL, auth scheme, field names, pagination shape) are
ungrounded LLM guesses — nothing in its 7-tool conversation loop (`find`/`get_resource`/
`test_connection`/`propose_*`, `assistant-conversation-loop`) can check a claim about a real
external API against current, factual documentation. `ClaudeClient` only ever constructs custom
function-tools (`ClaudeApiTool`) — no Anthropic server-side tool type is ever attached. The
live incident (2026-08-19): the assistant proposed a REST source at a hostname that has never
existed in DNS. `test_connection` (HEL-756, shipped) only catches this *after* a URL is already
picked; this change addresses not knowing the right URL in the first place.

## What Changes

- Add a genuine external-research capability the assistant can invoke before finalizing a
  REST-based source proposal, so base URL / auth / field-shape claims are grounded in real,
  fetched documentation rather than training-data recall alone.
- Extend the assistant conversation loop's tool set (or its `sendWithTools` request shape) so
  research results can flow into a `propose_pipeline`/`propose_combined` REST-source proposal
  before it's returned to the user.
- Exact mechanism (Anthropic server-side `web_search` tool vs. a custom function-tool backed by a
  search API), applicability scope (all turns vs. REST-source-authoring turns only), and
  freshness/safety filtering of fetched content are **open design questions** — resolved in
  design.md, not prejudged here.

## Capabilities

### New Capabilities
- `assistant-web-research`: grounds REST-source proposals in real, current external documentation
  via an external research capability invoked during proposal authoring.

### Modified Capabilities
- `assistant-conversation-loop`: every assistant turn (not just REST-source-authoring turns) now
  requests Anthropic's server-side `web_search` tool alongside the existing 7 client tools.
- `claude-api-client`: `ClaudeConfig` gains an env-sourced `web_search` call-budget setting;
  `ClaudeToolRequest`/`ClaudeClient` gain a distinct server-tool wire path (not the existing
  custom-function-tool path) and new content-block cases for `server_tool_use`/
  `web_search_tool_result`.

## Non-goals

- Does not change `test_connection` (HEL-756) — connection verification stays a distinct,
  post-URL-selection check.
- Does not add research capability to non-REST-source assistant turns unless design.md's scope
  question resolves that way.
- Does not attempt general-purpose open-ended web browsing — scoped to grounding a REST source
  proposal's factual claims.

## Impact

- `backend/src/main/scala/com/helio/ai/ClaudeClient.scala`, `ClaudeModels.scala`,
  `ClaudeWireModels.scala`, `ClaudeProtocol.scala` — if the server-side `web_search` tool path is
  chosen, these need a new tool-type distinction (server-executed vs. custom function-tool).
- `backend/src/main/scala/com/helio/services/AssistantToolExecutor.scala`,
  `WorkspaceAssistantTools.scala`, `AssistantService.scala` — tool list / dispatch changes.
- Cost/latency: an added research hop per applicable proposal turn.
