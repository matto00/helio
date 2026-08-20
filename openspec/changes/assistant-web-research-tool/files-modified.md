# Files modified — HEL-757 assistant-web-research-tool

## Backend — main

- `backend/src/main/scala/com/helio/ai/ClaudeConfig.scala` — adds `webSearchMaxUses: Int` (default `3`)
  sourced from `CLAUDE_WEB_SEARCH_MAX_USES` in `fromEnv()`; new field defaults so every existing
  5-arg construction site across the codebase keeps compiling unchanged.
- `backend/src/main/scala/com/helio/ai/ClaudeModels.scala` — adds `ClaudeToolRequest.webSearch: Boolean = false`;
  adds `ClaudeContentBlock.ServerToolUse(id, name, input)` / `ServerToolResult(toolUseId, name, result: JsValue)`
  cases for Anthropic's server-executed tool blocks.
- `backend/src/main/scala/com/helio/ai/ClaudeWireModels.scala` — introduces sealed `ClaudeApiToolSpec`
  (`ClaudeApiTool` is its "Custom" case; `ClaudeApiToolSpec.WebSearch(maxUses: Int)` is the new
  server-tool case); widens `ClaudeApiContentBlock` with a `serverToolResult: Option[JsValue]` field
  (kept separate from `text: Option[String]` so `web_search_tool_result`'s real JSON content
  round-trips losslessly); widens `ClaudeApiToolRequest.tools` from `Seq[ClaudeApiTool]` to
  `Seq[ClaudeApiToolSpec]` (covariant `Seq`, so every existing caller keeps compiling).
- `backend/src/main/scala/com/helio/ai/ClaudeProtocol.scala` — extends `claudeApiContentBlockFormat`
  to read/write `server_tool_use`/`web_search_tool_result` block types; adds
  `claudeApiToolSpecFormat: RootJsonFormat[ClaudeApiToolSpec]` (Custom delegates to the existing
  `claudeApiToolFormat`, byte-identical; WebSearch writes Anthropic's documented
  `{"type":"web_search_20250305","name":"web_search","max_uses":N}` shape — verified against
  Anthropic's official Python SDK (PyPI package `anthropic`, v0.86.0;
  github.com/anthropics/anthropic-sdk-python) type definitions: `WebSearchTool20250305Param`/
  `ServerToolUseBlock`/`WebSearchToolResultBlock`, during Execution, task 1.2).
- `backend/src/main/scala/com/helio/ai/ClaudeClient.scala` — `sendWithTools`'s `loop` now tracks a
  cumulative cross-hop `web_search` call count and threads it into `toApiToolRequest`, which appends
  a `WebSearch(remainingBudget)` entry (dropped entirely once the budget hits 0) AFTER the
  already-marked custom-tool sequence — the existing cache-marking logic (`markedTools`, typed
  `Seq[ClaudeApiTool]`) is untouched (design.md D2a); `toContentBlock`/`toApiContentBlock` gain
  `server_tool_use`/`web_search_tool_result` cases so these blocks round-trip through history exactly
  like every other block, but are excluded from `toolUses` so they're never dispatched to
  `executor.execute`; `flattenForEstimate` extended for the two new sealed-trait cases.
- `backend/src/main/scala/com/helio/infrastructure/AssistantConversationRepository.scala` — extends
  the repository-internal `claudeContentBlockFormat` (persisted conversation-transcript JSON) to
  round-trip the two new `ClaudeContentBlock` cases. Not explicitly listed in tasks.md, but necessary:
  without it, persisting a turn that contains a real `web_search` call (now possible on every
  `converse` call) would throw a `MatchError` in `AssistantConversationRoutes.converseFlow`'s
  `appendTurn` path — this keeps design.md's stated Goal ("round-trip through `ClaudeToolMessage`
  history faithfully") true end-to-end, not just at the wire layer.
- `backend/src/main/scala/com/helio/services/AssistantService.scala` — `converse` now sets
  `ClaudeToolRequest.webSearch = true` unconditionally (every turn, never gated on message content —
  design.md D1). `AssistantToolExecutor` itself is unchanged (task 3.2): its dispatch table and
  propose-quality counters are structurally unreachable by server-tool blocks, confirmed by code
  review and by the new `AssistantServiceSpec` coverage below.

## Backend — tests

- `backend/src/test/scala/com/helio/ai/ClaudeConfigSpec.scala` — `webSearchMaxUses` default (3) and
  `CLAUDE_WEB_SEARCH_MAX_USES` override (task 5.1).
- `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` — `webSearch=false` adds nothing to the
  outbound tool list / `webSearch=true` adds the server tool (5.2); cross-hop budget drop once
  exhausted (5.3); a search-only hop resolves `FinalResponse` with zero executor invocations, and a
  mixed hop (server-tool pair + client `tool_use`) invokes the executor exactly once for the client
  block only (5.4); re-verified the existing cache-marking test against the new
  `ClaudeApiToolSpec` sealed type, added a test that the last **custom** tool (not the appended
  `WebSearch` entry) stays the cache-marked one, and added a test confirming the D2a-documented
  cache-miss trade-off (the tools-array byte sequence differs hop-to-hop once `web_search` fires) is
  real (5.7).
- `backend/src/test/scala/com/helio/ai/HttpClaudeTransportSpec.scala` — real wire-serialization
  coverage for the `WebSearch` tool entry and the `server_tool_use`/`web_search_tool_result` block
  shapes (widened the `toolRequest` test helper's `tools` param to `Seq[ClaudeApiToolSpec]`).
- `backend/src/test/scala/com/helio/services/AssistantServiceSpec.scala` — every `converse` call sets
  `webSearch = true` regardless of message content (5.5); a REST-source proposal turn with a
  preceding `web_search` call in the same hop still enforces the existing `test_connection`
  structural gate unchanged (5.6).

## Docs

- `CLAUDE.md` — adds the `CLAUDE_WEB_SEARCH_MAX_USES` row to the production environment variables
  table, alongside the other `CLAUDE_*` settings (task 4.1).

## OpenSpec (planning artifacts, not "modified source")

- `openspec/changes/assistant-web-research-tool/tasks.md` — all 20 tasks marked complete.
- `openspec/changes/assistant-web-research-tool/files-modified.md` — this file.
