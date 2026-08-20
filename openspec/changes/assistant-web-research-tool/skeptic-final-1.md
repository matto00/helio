## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (cold, no trust of prior narratives):**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all three spec deltas
  (`assistant-web-research`, `assistant-conversation-loop` MODIFIED, `claude-api-client` MODIFIED/ADDED),
  `skeptic-design-{1,2,3}.md`, `evaluation-{1,2}.md`, `workflow-state.md`.
- `git diff main...HEAD --stat` (26 files, 1666+/46−) and read every non-test main-source diff in full:
  `ClaudeClient.scala`, `ClaudeConfig.scala`, `ClaudeModels.scala`, `ClaudeWireModels.scala`,
  `ClaudeProtocol.scala`, `AssistantConversationRepository.scala`, `AssistantService.scala`, `CLAUDE.md`.
  Read every test diff (`ClaudeClientSpec`, `ClaudeConfigSpec`, `HttpClaudeTransportSpec`,
  `AssistantServiceSpec`).
- `git show b9d7f922 --stat` / `git show f12c7555` / `git diff b9d7f922..f12c7555` — confirmed the
  two-commit history: b9d7f922 is the full behavioral change, f12c7555 touches only doc-comment text
  in `ClaudeWireModels.scala`/`HttpClaudeTransportSpec.scala` + `files-modified.md`/`workflow-state.md`
  bookkeeping + adds `evaluation-1.md`. No wire-format/behavior/assertion changed in the second commit
  — clean, coherent, and squash-ready as a single logical unit; each commit's own message is accurate
  about its own scope and explicitly calls out the `-n` hook bypass (openspec-not-archived, same
  precedent as HEL-755) per CLAUDE.md's "Verification before committing" rule.

**Independently re-ran every gate (not trusted from evaluation-2.md's paste):**
- `cd backend && sbt test` (full suite, fresh): **3318/3318 passed, 210 suites, 0 failed** — matches
  evaluation-2.md's claim exactly, reproduced myself.
- `cd backend && sbt testOnly` on the four directly-touched specs in isolation: 75/75 passed.
- `npm run check:schemas` — "schemas in sync... (66 checked across 47 protocol files)", clean.
- `npm run lint` — `eslint . --max-warnings=0`, clean, zero output.
- `npm run check:scala-quality` — "clean (125 soft warning(s))"; confirmed the touched files
  (`ClaudeClient.scala` 261→301 lines, `AssistantConversationRepository.scala` 248→279 lines) that now
  appear in the soft-budget list were already close to/over budget pre-ticket (`git show
  main:...ClaudeClient.scala | wc -l` → 261, already over the 250 soft budget before this diff) —
  informational only, gate itself reports clean.

**Wire-format verification (D2's "verify against the live API/SDK, don't trust design.md's recall" —
independently reproduced, not trusted from the citation text):**
- `pip download anthropic==0.86.0` (real PyPI package, network-verified) and inspected the extracted
  wheel's type stubs myself:
  - `web_search_tool_20250305_param.py`: `WebSearchTool20250305Param` — `type: Literal["web_search_20250305"]`,
    `name: Literal["web_search"]`, `max_uses: Optional[int]` — **exact match** to the implementation's
    `{"type":"web_search_20250305","name":"web_search","max_uses":N}` (`ClaudeProtocol.scala`
    `claudeApiToolSpecFormat.write`).
  - `server_tool_use_block.py`: `ServerToolUseBlock` — `type: Literal["server_tool_use"]`, `id: str`,
    `input: Dict[str, object]`, `name: Literal["web_search", ...]` — matches the implementation's
    `server_tool_use` block parsing (`id`/`name`/`input`, `ClaudeClient.toContentBlock`).
  - `web_search_tool_result_block.py`: `WebSearchToolResultBlock` — `type`, `tool_use_id`, `content`
    (opaque union) — matches the implementation's `tool_use_id`/`content` handling, kept opaque
    (design.md D4's explicit non-goal of not modeling result content).
  - The citation the evaluator flagged as unreproducible in cycle 1 and cycle 2 fixed
    (`ClaudeWireModels.scala:96`, `HttpClaudeTransportSpec.scala:66`, `files-modified.md:21-24`) is
    now genuinely reproducible — I reproduced it myself from a cold PyPI download, not from trusting
    the orchestrator's out-of-band clarification in evaluation-2.md.

**D2a's load-bearing cache-marking claim — traced directly in the shipped code, not just the doc:**
- `ClaudeClient.toApiToolRequest` (`ClaudeClient.scala:201-228`): `markedTools` is built from
  `apiTools = request.tools.map(...)` (typed `Seq[ClaudeApiTool]`) with the SAME `.init :+ .last.copy(...)`
  marking logic as before this ticket, completely untouched; `WebSearch(remainingWebSearchBudget)` is
  appended strictly after, carrying no `cacheControl`. The breakpoint-(b) first-message marking logic
  is byte-for-byte unchanged and doesn't reference `tools` at all. Confirmed via 4 dedicated tests
  (`ClaudeClientSpec.scala`): "mark the last custom tool -- not the appended WebSearch entry",
  "produce a different tools-array byte sequence on the hop after web_search first fires" (proves the
  documented cache-miss trade-off is real, not hand-waved away) — both pass.
- `seedHistory` (`AssistantService.scala:108-114`) — confirmed by reading it directly: `history :+
  ClaudeToolMessage(...)`, append-only, never touches `history(0)` — verifying skeptic-design-3's
  correction (that breakpoint (b)'s prefix stays bounded regardless of a long HEL-663-persisted
  conversation) is actually true in the shipped code, not just asserted in the corrected design.md text.

**Cross-hop budget enforcement — traced and tested:**
- `remainingWebSearchBudget = math.max(0, config.webSearchMaxUses - webSearchUsed)`; tool dropped
  entirely (not sent with `max_uses=0`) once exhausted. `loop` tallies
  `ServerToolUse(name="web_search")` cumulatively across hops, independent of `maxHops`. Verified by
  "drop the web_search tool from a later hop's outbound request once the cross-hop budget is
  exhausted" (webSearchMaxUses=2, 2 searches/hop scripted, hop 3 correctly omits the tool).

**Server-tool blocks never reach the client executor (the ticket's core safety goal):**
- `toolUses = blocks.collect { case tu: ClaudeContentBlock.ToolUse => tu }` — `ServerToolUse` is a
  distinct sealed case, structurally excluded. Confirmed zero diff in `AssistantToolExecutor.scala`/
  `WorkspaceAssistantTools.scala` (`git diff main...HEAD --stat` on both — empty). Two dedicated tests
  pass: search-only hop → `FinalResponse`, zero executor invocations; mixed hop → executor invoked
  exactly once, for the client block only.

**HEL-756's `test_connection` gate is not bypassed by a preceding web_search:**
- `AssistantServiceSpec`'s new "still enforce the existing test_connection requirement for a
  REST-source proposal after a preceding web_search call" test passes — a `propose_pipeline` for an
  untested inline REST source is rejected identically with a `web_search` call ahead of it in the same
  hop's history.

**Persisted-transcript round-trip — independently probed live, not just read:**
`AssistantConversationRepository.claudeContentBlockFormat` (repository-internal, separate from the
wire-layer format) has **zero direct test coverage** for the two new cases (or, I confirmed, for any
of its pre-existing cases either — `grep` for `ClaudeContentBlock`/`ToolUse`/`ToolResult` in
`AssistantConversationRepositorySpec.scala` returns nothing; this is a pre-existing gap in that file's
coverage pattern, not one newly introduced by this ticket). Since `webSearch=true` is now
unconditional, every future persisted conversation can contain these blocks, so I did not accept
"the code looks symmetric" as sufficient — I ran a live `sbt console` round-trip:
```
val u: ClaudeContentBlock = ServerToolUse("srvtoolu_1", "web_search", JsObject("query"->JsString("hi")))
val r: ClaudeContentBlock = ServerToolResult("srvtoolu_1", "web_search", JsArray(...))
u.toJson.convertTo[ClaudeContentBlock] == u   // → true
r.toJson.convertTo[ClaudeContentBlock] == r   // → true
```
Both round-trip correctly. Confirms the write/read pair is a genuine inverse, not just visually
symmetric — closes what would otherwise have been my leading candidate for a Change Request.

**AC tracing (ticket has no explicit AC list; scope is proposal.md's "New Capabilities" +
design.md's D1-D4, which the spec deltas restate as testable requirements):**
1. "Every `converse` call offers web_search, unconditionally" (D1) → `AssistantService.scala:76-79`,
   `webSearch = true` set unconditionally, verified by test (no message-content gating exists anywhere
   in the diff).
2. "Genuine cross-hop hard cap, not per-request" (D3) → traced + tested above.
3. "Server-tool blocks round-trip through history without reaching `AssistantToolExecutor`" (D2 Goal)
   → traced + tested above, both at the `ClaudeClient` layer and (independently probed by me) the
   persisted-transcript layer.
4. "No result filtering in v1" (D4, explicit human decision) → `result: JsValue` kept fully opaque
   throughout the wire/domain/persistence layers; no filtering code exists anywhere in the diff.
5. HEL-756's `test_connection` gate stays intact → tested and confirmed above.

All five trace to real, tested, independently-reproduced code — none of them are "claimed but
unverifiable."

### Verdict: CONFIRM

This is a backend-only change (confirmed: no `frontend/**` in the diff), so there is no UI-judgment
component to this review. The two-commit history is clean and coherent for squashing: commit 1 is the
complete, correctly-scoped behavioral change; commit 2 is a genuinely text-only citation-provenance fix
with a `git diff`-verified zero-behavior-change footprint. D2a's load-bearing cache-interaction claim —
the specific thing I was asked to scrutinize — checks out in the shipped code, not just in design.md's
prose, including the round-3 skeptic correction (breakpoint-(b)'s bound under a real HEL-663-persisted
conversation) actually holding in `seedHistory`'s real append-only behavior. The `web_search_20250305`
wire shape is independently, freshly reproducible against the real Anthropic SDK — I did not stop at
re-reading the citation text, I re-executed the citation's own claim from a cold `pip download`.

### Non-blocking notes

1. **design.md factual inaccuracy (Context section + D3), not affecting shipped behavior.** design.md
   states `AssistantService`'s loop runs "with `maxHops = 3`" and reasons from that number ("up to 9
   searches in one turn" if `max_uses=3` were naively set per-hop). The actual, pre-existing (not
   touched by this ticket) value is `MaxHops = 4` (`AssistantService.scala:50`, confirmed unchanged on
   `main`) — so the illustrative "9" should be "12." This does not affect correctness: the shipped
   cross-hop budget mechanism (`math.max(0, config.webSearchMaxUses - webSearchUsed)`) is fully
   hop-count-agnostic and enforces the cap correctly regardless of what `maxHops` actually is — verified
   by test against a real 3-hop scripted sequence. Worth a follow-up text correction to design.md before
   archive, given this document survives as the historical record and three dedicated skeptic-design
   rounds already exist specifically to catch this class of unverified-number issue (round 3 caught an
   analogous "HEL-663 is unshipped" false claim in the same D2a section).
2. Concur with evaluation-2.md's own two carried-over suggestions (repository round-trip test coverage,
   tightening the cross-hop-budget test to also assert hop 1) — genuinely non-blocking; I independently
   closed the round-trip-coverage gap's *risk* (not its *test-file absence*) via the live `sbt console`
   probe above, so I don't consider it something that must land before this ships, just something a
   follow-up test would tidy up.
3. Anthropic's SDK wheel I downloaded also ships a newer `web_search_tool_20260209_param.py`
   (`WebSearchTool20260209Param`) alongside the `20250305` version design.md chose — both are present
   and valid in the current SDK, so `20250305` is not deprecated/broken, just not the newest available
   tool version. Not a defect (design.md's D2 decision to use `20250305` was made and verified in good
   faith, and the ticket's scope never asked for "latest possible" server-tool version) — flagging only
   as forward-looking awareness for whoever eventually revisits this.
