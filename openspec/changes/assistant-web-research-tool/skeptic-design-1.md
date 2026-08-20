## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `workflow-state.md`, and all three spec deltas
  (`specs/claude-api-client/spec.md`, `specs/assistant-conversation-loop/spec.md`,
  `specs/assistant-web-research/spec.md`) and `tasks.md` in full.
- Confirmed the four escalation answers are actually incorporated: D1 (scope = every turn, no
  intent gating) matches proposal.md's "Modified Capabilities" bullet and the
  `assistant-conversation-loop` spec's "webSearch = true ... never gated on message content or
  intent" requirement; D2 (server-side `web_search` tool, distinct wire path) matches the
  `claude-api-client` spec's new "server-tool content blocks never dispatched to
  ClaudeToolExecutor" requirement; D3 (hard cap 2-3 → default 3, cross-hop, env-tunable) matches
  `ClaudeConfig`'s new `webSearchMaxUses` requirement and its two scenarios; D4 (no
  freshness/safety filtering) matches the `assistant-web-research` spec's explicit "not
  additionally filtered" requirement. No contradictions among the three spec deltas or between
  them and design.md.
- Read the actual ground-truth code the design proposes to touch:
  `backend/src/main/scala/com/helio/ai/ClaudeClient.scala` (full file, 262 lines),
  `ClaudeModels.scala` (full file), `ClaudeWireModels.scala` (full file), the relevant formatters
  in `ClaudeProtocol.scala` (lines 80-183), `ClaudeConfig.scala` (full file), and
  `backend/src/main/scala/com/helio/services/AssistantService.scala` (full file).
- Confirmed via `grep -rn sendWithTools backend/src/main/scala/` that `AssistantService` is
  genuinely the sole caller today, so D1's "exactly one caller" premise holds.
- Confirmed via `grep -rn "TODO|TBD|figure out later|placeholder"` across the whole change dir
  that there are no placeholders/hand-waving; design.md's own Planner Notes correctly scope what's
  legitimately deferred to Execution (exact Anthropic wire-format strings) vs. what's a genuine
  design-gate decision (all four escalation questions).
- Confirmed no `schemas/`/top-level API contract changes are implied (this is a purely
  backend-internal `ClaudeClient`/`AssistantService` change — `grep` for `web_search`/`webSearch`
  under `schemas/` and `openspec/specs/` returns nothing, consistent with proposal.md's Impact
  section never mentioning `schemas/`).

### The gap: the design never accounts for the existing tools-array prompt-cache breakpoint it will directly perturb

`ClaudeClient.toApiToolRequest` (`ClaudeClient.scala:170-195`) already has a documented,
**tested** invariant from a prior ticket: the *last* element of the `tools` array gets a
`cache_control` breakpoint, on the explicit assumption the tools array is
**"byte-identical-across-hops"** (the method's own docstring, line 166). This is asserted by a
passing test today:

```
backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala:468-482
"mark the last tools element and the first message's last content block with a cache breakpoint"
  built.tools.init.foreach(_.cacheControl shouldBe None)
  built.tools.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
```

and it feeds directly into an **already-shipped, unrelated spec** this change does not touch:
`openspec/specs/assistant-tool-loop-telemetry/spec.md`'s "A multi-hop turn's record shows nonzero
cache reads" scenario ("WHEN ... the loop ran 2 or more hops and the API reported cache reads for
the repeated prefix THEN ... `cacheReadInputTokens` is nonzero").

design.md's D2/D3 propose exactly the kind of change that breaks this invariant, and never once
mention it — I grepped the whole change directory for "cache" and got zero hits:

1. **D2** widens `ClaudeApiTool` into a sealed `ClaudeApiToolSpec` (`Custom`/`WebSearch(maxUses:
   Int)`), appended "alongside the existing custom-tool array" — i.e. `ClaudeApiToolRequest.tools`
   becomes `Seq[ClaudeApiToolSpec]`. The existing cache-marking code
   (`apiTools.init :+ apiTools.last.copy(cacheControl = Some(...))`) calls `.copy(cacheControl =
   ...)` directly on `apiTools.last`. For that to even compile against a sealed-trait element,
   `cacheControl` has to be a field common to every case of the new trait — design.md never says
   whether it is, and never says whether the marker still targets the last *custom* tool or now
   targets whatever is literally last in the widened array (which, per D2's own "appends...
   alongside", would now be the `WebSearch` entry).
2. **D3** makes that `WebSearch` entry's wire content genuinely vary hop-to-hop: `max_uses` is set
   to `max(0, config.webSearchMaxUses - usedSoFar)` on every hop, and the tool is dropped entirely
   once the budget hits 0. That means for exactly the scenario this ticket exists to enable — a
   `web_search` call in an earlier hop of a turn that also needs a later hop for a client tool call
   (e.g. `find` then `web_search` then `propose_pipeline`, the textbook "ground a REST proposal"
   flow) — the tools array is **not** byte-identical from hop 2 onward. If the cache-control marker
   ends up on the `WebSearch` entry (the natural reading of "appends...alongside"), the cache
   prefix is invalidated starting at hop 1→2 for every turn that ever calls `web_search` at all,
   not just ones that exhaust the budget.

Concretely, this is a real regression risk to prompt-caching cost/latency behavior that this
ticket's own escalation (cost/latency was one of the four open questions) never surfaced to the
human, because the design never noticed the interaction. It is also, independent of the caching
cost question, a **compile-time blocker**: the executor cannot literally write
`apiTools.last.copy(cacheControl = ...)` against a sealed trait without design.md first deciding
how `cacheControl` is exposed across `ClaudeApiToolSpec`'s cases.

tasks.md confirms this was never considered: task 1.3/1.4 cover widening `ClaudeApiTool` and
updating `claudeApiToolFormat`, but nothing in section 1 or 2 touches `toApiToolRequest`'s
cache-marking logic, and section 5's test list (5.1-5.6) has no task to update or re-verify
`ClaudeClientSpec.scala:468-487` against the new sealed type — meaning an executor could easily
"fix" that test to keep compiling (e.g. by re-pointing the assertion at whatever element happens
to be last) without ever noticing the underlying cache-hit-rate regression it's papering over.

### Verdict: REFUTE

### Change Requests

1. **design.md must add a Decision (or extend D2/D3) that explicitly reconciles the web-search
   tool's per-hop-varying `max_uses`/presence with the existing tools-array cache breakpoint in
   `toApiToolRequest` (`ClaudeClient.scala:166-195`, tested at `ClaudeClientSpec.scala:468-487`).**
   At minimum it needs to state:
   - Whether `cacheControl` is a member of every `ClaudeApiToolSpec` case (required for
     `apiTools.last.copy(cacheControl = ...)` to type-check at all once `ClaudeApiTool` becomes one
     case of a sealed trait) or whether the marking logic is restructured (e.g. pattern-matched)
     instead.
   - Where the `web_search` wire entry is positioned relative to the custom tools, and whether the
     cache breakpoint still targets the last *custom* tool (preserving the existing stable-prefix
     property for the 7 client tools regardless of search usage) or now targets whatever is
     literally last in the array.
   - Whether the design accepts, as a documented trade-off, that a turn which calls `web_search` in
     an earlier hop before needing a later hop for a client tool call will lose the tools-array
     cache hit for that later hop (this is the ticket's own primary target flow: research before
     `propose_pipeline`) — or instead keeps the `max_uses` field's wire value **constant** across
     hops (toggling only the tool's presence/absence at the one hop it's fully exhausted, never its
     numeric value) to preserve prefix stability up to that point.
   - An explicit note reconciling this with `assistant-tool-loop-telemetry`'s already-shipped "A
     multi-hop turn's record shows nonzero cache reads" scenario, so a future evaluator/skeptic
     knows this was a considered trade-off, not an overlooked regression.
   Add a corresponding tasks.md item under section 2 (updating `toApiToolRequest`'s cache-marking
   code) and section 5 (updating/re-verifying `ClaudeClientSpec.scala`'s existing
   "mark the last tools element...with a cache breakpoint" test against the new sealed type and the
   chosen approach above).

### Non-blocking notes

- `AssistantService.toolCallCount`/`AssistantTurnResult.toolCallCount` counts only client
  `ClaudeContentBlock.ToolUse` blocks (`AssistantService.scala:219-223`); design.md is silent on
  whether `web_search` invocations should also show up in that count or any UI/telemetry surface.
  Given D2 explicitly keeps `ServerToolUse` out of the client-tool code paths this is probably fine
  as-is, but worth a one-line acknowledgment in design.md's Non-Goals so it reads as a decision
  rather than an oversight.
- Task 1.5's `ClaudeApiContentBlock` extension will need at least one new `Option[JsValue]`-shaped
  field to hold `web_search_tool_result`'s result payload without lossy stringification through the
  existing `text: Option[String]` field — implied but not spelled out. Low risk; a competent
  executor will hit this naturally via the sealed-trait match needing to compile.
