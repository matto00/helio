## 1. Backend: Config & wire models

- [x] 1.1 Add `webSearchMaxUses: Int` to `ClaudeConfig`, sourced from `CLAUDE_WEB_SEARCH_MAX_USES`
      (default `3`) in `ClaudeConfig.fromEnv()`.
- [x] 1.2 Verify Anthropic's current server-side `web_search` tool wire shape (type version string,
      field names, response content-block shapes) against the live API/vendored SDK/docs — do not
      trust design.md's recall alone (design.md D2/Risks).
- [x] 1.3 Widen `ClaudeApiTool` into a sealed `ClaudeApiToolSpec` (`Custom`/`WebSearch(maxUses: Int)`)
      in `ClaudeWireModels.scala`.
- [x] 1.4 Update `claudeApiToolFormat` (`ClaudeProtocol.scala`) to write each `ClaudeApiToolSpec`
      case's own wire shape.
- [x] 1.5 Add `ClaudeContentBlock.ServerToolUse(id, name, input)` /
      `ServerToolResult(toolUseId, name, result: JsValue)` cases (`ClaudeModels.scala`) and extend
      `ClaudeApiContentBlock`/its JSON reader (`ClaudeProtocol.scala`) to round-trip
      `server_tool_use`/`web_search_tool_result` block types.

## 2. Backend: ClaudeClient tool-use loop

- [x] 2.1 Add `webSearch: Boolean = false` to `ClaudeToolRequest`.
- [x] 2.2 In `toApiToolRequest`, append the web_search server-tool wire object when
      `request.webSearch` is true, with `max_uses` set to the remaining cross-hop budget for that hop.
- [x] 2.3 In `sendWithTools`'s `loop`, track cumulative `web_search` `ServerToolUse` invocations
      across hops; omit the web_search tool from any subsequent hop's outbound request once
      `config.webSearchMaxUses` is reached.
- [x] 2.4 Ensure `ServerToolUse`/`ServerToolResult` blocks are appended to history exactly as
      received but never passed to `executor.execute` (only `ToolUse` blocks are).
- [x] 2.5 Update `toApiToolRequest`'s cache-marking logic (design.md D2a): keep marking the last
      *custom* tool only (`Seq[ClaudeApiTool]`, unchanged from today), and append the `WebSearch`
      entry (when `request.webSearch`) after that already-marked sequence, always unmarked — never
      mark or include `WebSearch` in the byte-identical-prefix invariant.

## 3. Backend: AssistantService wiring

- [x] 3.1 Set `ClaudeToolRequest.webSearch = true` unconditionally in `AssistantService.converse`
      (every turn, never gated on message content).
- [x] 3.2 Confirm `AssistantToolExecutor`'s existing dispatch table and propose-quality telemetry
      counters (`proposeAttempts`/etc.) are unaffected — server-tool blocks never reach `execute`.

## 4. Backend: Docs

- [x] 4.1 Add `CLAUDE_WEB_SEARCH_MAX_USES` to `CLAUDE.md`'s production environment variables table,
      matching the existing `CLAUDE_*` row style.

## 5. Tests

- [x] 5.1 `ClaudeConfig.fromEnv()` — `webSearchMaxUses` default (3) and env override.
- [x] 5.2 `ClaudeClient.sendWithTools` — `webSearch = false` (default) adds nothing to the outbound
      tool list; `webSearch = true` adds the server tool alongside custom tools.
- [x] 5.3 `ClaudeClient.sendWithTools` — cross-hop web_search budget: tool is dropped from a hop's
      request once the cumulative count reaches `webSearchMaxUses`, independent of `maxHops`.
- [x] 5.4 `ClaudeClient.sendWithTools` — a hop with both a `server_tool_use`/`web_search_tool_result`
      pair and a client `tool_use` block invokes `executor.execute` exactly once, for the client
      block only.
- [x] 5.5 `AssistantService.converse` — every call sets `webSearch = true` regardless of message
      content (no intent gating).
- [x] 5.6 `AssistantService.converse` — a REST-source proposal turn with a preceding `web_search`
      call still enforces the existing `test_connection` requirement unchanged.
- [x] 5.7 Update/re-verify `ClaudeClientSpec.scala`'s existing "mark the last tools element...with a
      cache breakpoint" test (~line 468) against the new `ClaudeApiToolSpec` sealed type: (a) the
      tools-only marker's position/value stays on the last *custom* tool regardless of `webSearch`;
      (b) the first-message marker (`built.messages.head.content.last.cacheControl`) is unaffected on
      hop 1 of a turn, but — per design.md D2a's accepted trade-off — a hop where the cumulative
      web_search budget changed produces a *different* tools-array byte sequence than the prior hop
      (confirming the documented cache-miss trade-off is real, not silently absent).
