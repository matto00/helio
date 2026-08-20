## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three spec deltas
  (`specs/claude-api-client/spec.md`, `specs/assistant-conversation-loop/spec.md`,
  `specs/assistant-web-research/spec.md`) in full, as a fresh gate — not assuming round 1's other
  findings still hold.
- Confirmed D1/D3(scope,cap)/D4 are internally consistent with the spec deltas and with each other;
  no placeholders/TBDs found in the current change dir.
- Confirmed the ticket (`ticket.md`) itself lists "Cost/latency tradeoffs of an added web-research hop
  per proposal" as an explicit open design question design.md is required to resolve — directly
  relevant to the finding below.
- Read the ground-truth code `toApiToolRequest` touches:
  `backend/src/main/scala/com/helio/ai/ClaudeClient.scala:166-195` (current state, full method) —
  confirmed it marks **two** cache breakpoints today, not one: (a) `apiTools.last` (the last tools-array
  element) and (b) `history.head`'s (the first message's) last content block.
- Read `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala:466-488`, which asserts both
  breakpoints independently (`built.tools.last.cacheControl`/`built.messages.head.content.last.cacheControl`).
- Read the archived `assistant-prompt-caching` design.md
  (`openspec/changes/archive/2026-08-17-assistant-prompt-caching/design.md`) — the ticket that
  introduced both breakpoints — to ground what each breakpoint is actually *for*. Its D3 states
  explicitly: "Marking the first message's *last* block (not first) maximizes the cached span of the
  first turn." Its D5 states: "A multi-hop turn logs nonzero `cacheReadInputTokens` (AC #2): **hop 1
  writes the prefix cache, hops 2/3 read it**." This confirms the *first-message* breakpoint — not the
  tools-only breakpoint — is the one that carries the large, valuable, multi-hop cache benefit this
  ticket's own D2a leans on for its "no regression" claim.
- Confirmed via `openspec/specs/assistant-tool-loop-telemetry/spec.md`'s "A multi-hop turn's record
  shows nonzero cache reads" scenario that this is exactly the shipped, currently-tested behavior D2a
  claims to preserve.

### D2a's resolution does not actually hold up

Round 1's Change Request 1 is only **partially** resolved. D2a correctly fixes:
- The compile-time concern: the cache-marking code stays typed against `Seq[ClaudeApiTool]` ("the
  `Custom` case") before ever widening to `ClaudeApiToolSpec`, so `.copy(cacheControl = ...)` doesn't
  need `cacheControl` to be a field common to every sealed-trait case.
- The ordering ambiguity: `WebSearch` is explicitly placed after the marked custom-tool sequence.

But D2a's central factual claim — quoted directly from design.md lines 79-82 — is:

> "Anthropic's prompt cache reuses a request's prefix up to and including its last breakpoint
> regardless of what follows it, so an unmarked, hop-varying trailing entry costs nothing: the
> 7-client-tool prefix — and its existing tested cache-read behavior — stays exactly as byte-identical
> across hops as before this change, **in every turn, whether or not web_search fires**."

This is true only for the *narrow* claim about breakpoint (a) — the tools-only marker's own position
and the small prefix it alone covers. It is **not** true for breakpoint (b), the first-message marker,
which is the one the codebase's own comments (`toApiToolRequest`'s docstring, the archived
`assistant-prompt-caching` design.md D3/D5) identify as the one that "maximizes the cached span" and
delivers the "hop 1 writes, hops 2/3 read" behavior the referenced telemetry scenario actually tests.

Anthropic's documented prompt-cache mechanism checks the **longest matching prefix** — cumulative
identity of everything up to and including a given breakpoint, in the canonical order
tools → system → messages — not independent, isolated segments per breakpoint. Content placed *after*
breakpoint (a) but still *before* breakpoint (b) (i.e., inside the same request, ahead of the messages
section) is not excluded from what breakpoint (b)'s prefix must match — it is exactly the token content
that sits between the two breakpoints. So:

1. `WebSearch`'s wire `max_uses` field, per D3 (unchanged by D2a), is set to
   `max(0, config.webSearchMaxUses - usedSoFar)` on **every** hop — a value that changes on every hop
   after the first `web_search` call fires (e.g. `3 → 2 → 1 → 0`), not just once at exhaustion (task 2.2
   confirms: "with `max_uses` set to the remaining cross-hop budget for that hop", per-hop).
2. Because `WebSearch` sits inside the `tools` array — ahead of the `messages` section that carries
   breakpoint (b) — every hop after the first search call has a **different** tools-array byte sequence
   than the previous hop's, even though breakpoint (a)'s own narrow prefix (up to the last *custom*
   tool) is untouched.
3. That means breakpoint (b)'s full prefix (tools including the now-different `WebSearch` entry, +
   system, + messages up to `history.head`'s last block) is **not** byte-identical between hop N and
   hop N+1 once a search has occurred — so the cache **misses** at breakpoint (b) on that later hop,
   even though it would have hit before this change.
4. This lands precisely on the ticket's own primary target flow, called out explicitly in round 1's
   report and never disputed since: `find` → `web_search` → `propose_pipeline` in one turn — i.e. a
   search in an early hop followed by a later hop that needs a client tool call. That is the textbook
   "ground a REST proposal" scenario this whole ticket exists to enable.
5. The cost implication is worse than "reduced benefit": Anthropic's cache **writes** carry a documented
   ~1.25x token surcharge (noted in the archived `assistant-prompt-caching` design.md's own Risks
   section). Because each hop's `max_uses` value is very likely unique to that specific
   turn-and-hop-position, the large breakpoint-(b) cache entry written on hop 2 (paying the write
   surcharge) is unlikely to ever be *read* by a future hop or turn — so a turn that uses `web_search`
   and then needs a later hop may now cost *more* than before this change for that large prefix, not
   merely "the same, no benefit."

design.md's own text (D2a, and D3's added "Safe to vary freely hop-to-hop per D2a" sentence) asserts
this interaction is a non-issue ("never invalidates the custom-tool cache read... in every turn, whether
or not web_search fires"), without ever distinguishing between the two breakpoints. tasks.md 5.7 and
design.md's description of what's tested only cover "the custom-tool cache prefix (marker
position/value)" — i.e., breakpoint (a) alone — never breakpoint (b)'s byte-identity across a hop where
`web_search`'s budget changed, which is the one that actually matters for the shipped
"multi-hop turn shows nonzero cache reads" telemetry scenario and for the ticket's own listed
cost/latency open question.

This is not a restatement of round 1's finding — round 1 flagged that D2/D3 never *mentioned* caching at
all. D2a does mention it, and correctly fixes the compile-time and ordering half of the concern. What
remains unresolved is a distinct, more specific technical claim: that appending unmarked, hop-varying
content *after* an earlier breakpoint but *before* a *later* breakpoint is cost/cache-neutral. It isn't,
under Anthropic's documented cumulative-prefix caching model, and under this specific codebase's own
two-breakpoint `toApiToolRequest` implementation.

### Verdict: REFUTE

### Change Requests

1. **Correct D2a's technical claim to account for the *second* cache breakpoint** (`toApiToolRequest`'s
   `markedMessages` marker on `history.head`'s last content block, `ClaudeClient.scala:178-187`), not
   just the tools-only breakpoint. Cite the archived `assistant-prompt-caching` design.md's own D3/D5
   rationale ("maximizes the cached span... hop 1 writes the prefix cache, hops 2/3 read it") to
   establish that this second breakpoint — not the narrow tools-only one — is what the "multi-hop turn
   shows nonzero cache reads" telemetry scenario and the ticket's own cost/latency open question
   actually depend on.

2. **Make an explicit, justified design decision on the trade-off**, rather than asserting it away.
   Concrete options design.md must choose between and justify:
   - **(a) Accept the regression as a documented trade-off.** State plainly that any turn where
     `web_search` fires before a later hop needing a client tool call (the ticket's own primary target
     flow) loses the large first-message cache benefit for that later hop — both `cacheReadInputTokens`
     and the incurred `cacheCreationInputTokens` write surcharge — and give a reasoned basis for why
     that's acceptable (expected frequency of multi-hop-after-search turns, magnitude of the token/cost
     delta, etc.), updating the Risks/Trade-offs section accordingly.
   - **(b) Redesign the budget-enforcement mechanism to avoid varying the wire `max_uses` value
     continuously per hop.** If chosen, design.md must work out — not leave implicit — how a
     constant-per-hop `max_uses` (toggling only presence/absence, once, at the hop where the cumulative
     cap is reached) still guarantees the cross-hop total never exceeds `config.webSearchMaxUses`; D3's
     current text explicitly rejected a constant value for exactly this reason (the "9 searches"
     over-cap scenario), so this tension must be resolved on the record, not silently reintroduced.
   Either way, the resolution must be stated in terms of *both* breakpoints, not just the tools-only one.

3. **Update task 5.7 and design.md's description of test coverage** to match whichever option is
   chosen in CR2: a test asserting `built.messages.head.content.last.cacheControl`/prefix-byte-identity
   behavior across a hop boundary where the web_search budget changed — either confirming the
   documented regression under option (a), or confirming stability is preserved under option (b). As
   currently scoped, task 5.7 only tests breakpoint (a) ("the custom-tool cache prefix (marker
   position/value)"), which is not what's actually at risk.

### Non-blocking notes

- The round-1 report's other two non-blocking notes (toolCallCount not counting web_search invocations;
  `ClaudeApiContentBlock`'s new `Option[JsValue]` field for `web_search_tool_result`) remain accurate
  and unaddressed in design.md, but are low-risk and were correctly not treated as blocking in round 1.
- Environmental note (not a code/design issue): this worktree's checked-out `scripts/concertino/`
  predates `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (its branch HEAD, `7688a153`,
  is not an ancestor of local `main`'s HEAD `fd930868`, and its own `scripts/concertino/` tree lacks
  these three files). I invoked the main checkout's current copies of these scripts against this
  worktree's paths (verified they resolve worktree/main-checkout paths independently via `git -C`/
  `git rev-parse --git-common-dir`, so this is safe) rather than treating this as a review BLOCKER,
  since it doesn't affect anything under review. Worth a rebase before the next round regardless.
