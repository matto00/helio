## Context

`ClaudeClient.sendWithTools` (`backend/src/main/scala/com/helio/ai/ClaudeClient.scala:71-118`) runs a
bounded, multi-hop **client** tool-use loop: every `tool_use` block in a hop's response is dispatched to
a caller-supplied `ClaudeToolExecutor`, appended as a `tool_result`, and the loop recurses until either a
tool-free response arrives or `request.maxHops` is exhausted. `ClaudeTool`/`ClaudeApiTool`
(`ClaudeModels.scala:122`, `ClaudeWireModels.scala:68`) model only custom function-tools
(`name`/`description`/`input_schema`) — there is no Anthropic **server-side** tool type anywhere in the
wire layer. `AssistantService.converse` (`AssistantService.scala:57-79`) is the sole `sendWithTools`
caller in the codebase today (`grep -rl sendWithTools` confirms this), running a 7-tool loop
(`find`/`get_resource`/`test_connection`/`propose_*`) with `maxHops = 4`.

Resolved via Planning escalation (see `workflow-state.md`/`.concertino/runs/HEL-757/events.jsonl`):
web_search is attached on **every** `converse` call, using Anthropic's **server-side** `web_search`
tool, hard-capped at **3** calls per turn (human said "2-3"; see Decision 3 for why 3, env-tunable), with
**no** freshness/safety filtering in v1.

## Goals / Non-Goals

**Goals:**
- Every `AssistantService.converse` call offers Claude a real, current external-research capability
  (Anthropic's server-side `web_search` tool), not gated on message content/intent.
- A genuine per-turn hard cap on search calls, enforced across the whole multi-hop loop — not just
  per individual API request.
- Server-tool content blocks (`server_tool_use`/`web_search_tool_result`) round-trip through
  `ClaudeToolMessage` history faithfully, without being misrouted into the client `ToolUse` dispatch
  path (`AssistantToolExecutor` must never see one).

**Non-Goals:**
- No freshness/safety filtering of search results in v1 (explicit human decision — revisit only if a
  real problem surfaces).
- No change to `test_connection` (HEL-756) — distinct, post-URL-selection check.
- No new callers of `sendWithTools` beyond the existing `AssistantService` — `web_search` is opt-in per
  `ClaudeToolRequest`, so no other current or future `ClaudeClient` caller is silently affected.
- No result-quality/relevance scoring beyond what Anthropic's own `web_search` tool already provides.

## Decisions

**D1 — Scope: attached unconditionally in `AssistantService.converse`, not intent-gated.**
Since `sendWithTools` has exactly one caller, "every assistant turn" resolves cleanly to "every
`converse` call always sets `ClaudeToolRequest.webSearch = true`" — no per-turn REST-source detection,
no new branching logic. Alternative considered: gate on detecting REST-source-authoring intent first —
rejected per the escalation answer, and it would need its own (unreliable) intent classifier.

**D2 — Mechanism: a distinct server-tool wire path, not a `ClaudeToolExecutor` entry.**
Add `ClaudeConfig.webSearchMaxUses: Int` (env `CLAUDE_WEB_SEARCH_MAX_USES`, default `3`) and
`ClaudeToolRequest.webSearch: Boolean = false` (default off — every non-`AssistantService` caller is
unaffected). When `true`, `ClaudeClient.toApiToolRequest` appends one wire-level web-search tool object
(`{"type": "web_search_20250305", "name": "web_search", "max_uses": N}` — Anthropic's documented
server-tool shape; **the executor must verify this exact type string/field names against the live
Anthropic API reference during Execution**, not trust this design doc's recall alone — the same
ungrounded-guess risk this ticket exists to close, now turned on ourselves) alongside the existing
custom-tool array. `ClaudeApiTool` becomes one case (`Custom`) of a new sealed `ClaudeApiToolSpec`,
alongside `WebSearch(maxUses: Int)`; `claudeApiToolFormat` becomes a format over the sealed trait,
writing each case's own wire shape. `ClaudeContentBlock` gains `ServerToolUse(id, name, input)` and
`ServerToolResult(toolUseId, name, result: JsValue)` cases (`result` kept opaque/pass-through — no need
to model Anthropic's internal result shape given the Non-Goal of not filtering it); the wire-level
`ClaudeApiContentBlock` gains a matching `serverToolResult: Option[JsValue]` field so
`web_search_tool_result` round-trips without lossy stringification through the existing
`text: Option[String]` field. These are handled inside `ClaudeClient.sendWithTools`'s own loop,
alongside `ClaudeContentBlock.ToolUse` filtering — they are collected separately and never passed to
`executor.execute`, so `AssistantToolExecutor` (and its existing `propose_*`/telemetry counters, and
`AssistantService.toolCallCount`, which by design counts only client `ToolUse` blocks) needs zero
changes. Alternative considered: model `web_search` as an ordinary `ClaudeTool` whose "execution" is a
no-op client callback — rejected: Anthropic executes server tools inline during generation (no extra
client round trip, no `tool_result` the client constructs), so forcing it through the existing
client-tool shape would be actively misleading about control flow, not just inconvenient.

**D2a — Cache-prefix reconciliation (skeptic design-gate rounds 1-2).** `toApiToolRequest` marks
**two** breakpoints (`ClaudeClient.scala:166-195`, tested at `ClaudeClientSpec.scala:466-488`): (a) the
last tools-array element, and (b) the first message's last content block. The archived
`assistant-prompt-caching` design.md's own D3/D5 establish that (b) — not (a) — is what "maximizes the
cached span" and delivers "hop 1 writes the prefix cache, hops 2/3 read it," which is what
`assistant-tool-loop-telemetry`'s shipped "multi-hop turn shows nonzero cache reads" scenario actually
exercises. Anthropic's cache matches the longest identical prefix in canonical order
(tools → system → messages); content between (a) and (b) is still part of what (b) must match. `Custom`
tools keep their existing `cacheControl` field and marking logic unchanged (`apiTools =
customs.init :+ customs.last.copy(cacheControl = Ephemeral)`, typed against `Seq[ClaudeApiTool]` only,
never the sealed trait); `WebSearch(N)` is appended after, carrying no `cacheControl` field of its own
— this resolves round 1's compile-time/ordering concern, and (a)'s own narrow prefix genuinely stays
byte-identical regardless of `web_search`. But `WebSearch`'s `max_uses` (D3) varies every hop after a
search fires (`3→2→1→0`), sitting inside `tools`, ahead of `messages` — so (b)'s *full* prefix (which
includes the tools array) differs hop-to-hop once `web_search` has fired, missing (b)'s cache read for
that later hop — exactly the ticket's own primary target flow (`find`→`web_search`→`propose_pipeline`).

**Accepted trade-off, not redesigned away:** a turn that calls `web_search` then needs a later hop for
a client tool loses breakpoint (b)'s cache read (and repays its ~1.25x write surcharge) for that hop.
A constant-per-hop `max_uses` would preserve (b) but only cap each *individual* hop, reintroducing the
up-to-12-searches-per-turn risk D3 exists to prevent — the explicit "hard cap" the human asked for wins
over this optimization. The lost span is also bounded, even though HEL-663 (conversation persistence)
has already shipped and `AssistantConversationRoutes.converseFlow` loads a real, potentially long
persisted transcript as `history` on every live call: breakpoint (b) marks only `history.head`
(`ClaudeClient.scala:178-187`), and `AssistantService.seedHistory` (`AssistantService.scala:105-111`)
only ever *appends* a new turn — it never rewrites `history.head`. So the prefix subject to a
breakpoint-(b) cache miss stays fixed at "tools array + the conversation's original first turn"
regardless of how long-running the conversation has become. Revisit only if real telemetry shows this
materially regresses cost (same precedent as D4).

**D3 — Cap: a cross-hop budget owned by `ClaudeClient`, reconciling "every turn" (D1) with "per
proposal turn" (the human's own phrasing).** The cap is scoped to one `ClaudeToolRequest` — i.e. one
`sendWithTools` call, which is exactly one `converse` invocation, i.e. "one assistant turn" — regardless
of whether that turn touches a `propose_*` call at all (satisfies D1's breadth; the human's "per
proposal turn" phrasing is read as shorthand for "per turn," since scope (D1) was decided broader than
proposal turns specifically). Anthropic's own `max_uses` field only bounds a *single* API request, but
`sendWithTools` issues one fresh request per hop (up to `maxHops = 4` today) — naively setting
`max_uses = 3` on every hop could allow up to 12 searches in one turn. So `ClaudeClient`'s `loop` counts
`ServerToolUse(name = "web_search")` blocks cumulatively across hops; each subsequent hop's wire
`max_uses` is set to `max(0, config.webSearchMaxUses - usedSoFar)`, and the web-search tool is dropped
from that hop's `apiTools` entirely once the budget hits 0 (mirrors the existing
`thisHop > request.maxHops` "stop offering it" pattern, applied to search-call budget instead of hop
count). Varying this value hop-to-hop is what costs the breakpoint-(b) cache read D2a documents — an
accepted trade-off for a genuine hard cap, not a free operation. Default `3` (the upper bound of the
human's "2-3" range) — chosen over `2` because Anthropic's own within-hop enforcement already caps any
single hop, so the cross-hop guard is the binding constraint either way. Operator-tunable via
`CLAUDE_WEB_SEARCH_MAX_USES` if `2` proves more appropriate later.

**D4 — No freshness/safety filtering in v1.** Search results flow back into Claude's own context
entirely through Anthropic's server-side execution — `ClaudeClient` never sees raw result content to
filter even if it wanted to (D2's `result: JsValue` is opaque pass-through). Trusting `web_search`'s own
relevance/quality is the explicit human decision; revisit only if a real problem surfaces (e.g. add an
`allowed_domains`/`blocked_domains` wire field to the D2 tool object — additive, no re-architecture).

## Risks / Trade-offs

- **[Risk]** The exact Anthropic wire-format (`type` version string, block field names) may have moved
  since training data → **[Mitigation]** D2's explicit verification instruction; executor confirms
  against a real request/response (or the vendored Anthropic docs/SDK if present) before finalizing
  `ClaudeProtocol.scala`, per the `systematic-debugging` Iron Law (probe-confirmed, not recalled).
- **[Risk]** `CLAUDE_MODEL` (default `claude-opus-4-8`) may not support server-side `web_search` →
  **[Mitigation]** executor verifies model support during Execution; surfaces as an `ApiError`, not a
  silent no-op — no fallback mechanism is in scope for v1 (Non-Goals).
- **[Trade-off]** No result filtering (D4) means a genuinely malicious/compromised search result could
  reach the assistant's context — accepted per explicit human decision, scoped to v1.
- **[Trade-off]** D2a: a turn that calls `web_search` then needs a later hop for a client tool loses the
  first-message cache-read benefit (and repays the write surcharge) for that hop — accepted in favor of
  a genuinely enforced hard cap; see D2a for the full reasoning and bound.
- **[Risk]** Every `converse` call now costs an extra (bounded) search budget even off-topic turns →
  **[Mitigation]** accepted per D1; the cap (D3) bounds it, and search only fires if Claude chooses to.

## Migration Plan

Pure backend code change — no DB schema/migration. Deploy is an ordinary backend release; rollback is
reverting to the pre-change build. New env var `CLAUDE_WEB_SEARCH_MAX_USES` (optional, default `3`)
added to `CLAUDE.md`'s production env var table alongside the other `CLAUDE_*` settings.

## Planner Notes

Self-approved: exact wire-format field names (D2) are an implementation-verification task for the
executor, not a design-gate blocker — the human's four escalation answers already resolved every
genuine judgment call (scope, mechanism, cap, filtering).
