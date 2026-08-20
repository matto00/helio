## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, all three spec deltas
  (`specs/claude-api-client/spec.md`, `specs/assistant-conversation-loop/spec.md`,
  `specs/assistant-web-research/spec.md`), and both prior skeptic reports (`skeptic-design-1.md`,
  `skeptic-design-2.md`) as claims to verify, not facts, per this run's explicit "genuinely fresh
  gate" instruction.
- Confirmed D2a now correctly describes **both** cache breakpoints (`ClaudeClient.scala:166-195`):
  read `toApiToolRequest` in full — `markedTools` marks only `apiTools.last` (breakpoint a, typed
  against `Seq[ClaudeApiTool]`, i.e. the `Custom` case, before the sealed-trait widening — resolves
  round 1's compile-time concern), and `markedMessages` independently marks `history.head`'s last
  content block (breakpoint b). This matches design.md's D2a text exactly, including the citation of
  the archived `assistant-prompt-caching` design.md's D3 ("maximizes the cached span of the first
  turn") and D5 ("hop 1 writes the prefix cache, hops 2/3 read it") — verified those quotes are
  accurate against `openspec/changes/archive/2026-08-17-assistant-prompt-caching/design.md:53,71`.
- Confirmed `ClaudeClientSpec.scala:466-488`'s existing test asserts both breakpoints independently,
  as design.md/tasks.md 5.7 both describe.
- Confirmed D2a's "narrow claim" now holds: `WebSearch` is appended after the already-marked custom
  tools sequence and carries no `cacheControl` of its own, so breakpoint (a)'s own short prefix is
  genuinely untouched by `webSearch`/`max_uses` varying. Confirmed the accepted-trade-off framing
  (D2a + the new Risks/Trade-offs bullet + D3's corrected "safe to vary freely" sentence) is now an
  explicit, justified choice (option (a) from round 2's CR2), not an assertion-away — it states the
  regressed hop, the cost mechanism (cache-miss + ~1.25x write surcharge), and why the hard cap wins
  over the optimization, per round 2's requirement.
- Confirmed tasks.md 5.7 was rewritten to test breakpoint (b) specifically: hop-1 stability plus an
  assertion that a hop where the cumulative web_search budget changed produces a *different*
  tools-array byte sequence than the prior hop — the correct client-observable proxy for "this causes
  a cache miss under Anthropic's documented longest-matching-prefix behavior," since caching itself
  isn't observable from a unit test. This is what's actually at risk; round 2's CR3 is resolved.
- Sanity-passed the rest of the change for three-rounds-of-editing drift: `proposal.md`,
  `specs/claude-api-client/spec.md`, `specs/assistant-conversation-loop/spec.md`,
  `specs/assistant-web-research/spec.md`, `ticket.md`, `tasks.md` sections 1-4, and
  `workflow-state.md` — no contradictions found; D1/D3(scope/cap)/D4 still line up with the spec
  deltas and with each other; no new placeholders/TBDs (`grep -n "TODO\|TBD"` across the change dir:
  no hits).

### The remaining gap: D2a's "bounded" justification rests on a factually false claim about HEL-663

Design.md line 92 (D2a's accepted-trade-off paragraph):

> "The lost span is also bounded: `history`'s first turn is a caller-supplied, typically short seed
> today (HEL-663 conversation persistence, which would grow it, is a later ticket)."

This is the stated reason the design treats the breakpoint-(b) cache-miss regression as low-severity
enough to accept without further mitigation. I checked it against ground truth and it is false:

- `git -C <worktree> log --oneline --all | grep 663` → `HEL-663 Add assistant conversation
  persistence (Postgres metadata + FileSystem transcript blob) (#341)` (commit `1c3c4688`).
- `git -C <worktree> merge-base --is-ancestor 1c3c4688 HEAD` → true. HEL-663 is not a "later
  ticket" relative to this change — it is **already merged and an ancestor of this very worktree's
  HEAD**, along with several tickets built on top of it (`HEL-698` idempotency, `HEL-700` prompt
  quality, `HEL-703` tier gating — all visible in `git log -- backend/.../AssistantConversationRoutes.scala`).
- Read `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala` in full:
  `converseFlow` (lines ~139-172) is a **live route**, `POST /assistant-conversations/:id/converse`,
  that does `val history = existing.transcript.convertTo[Seq[ClaudeToolMessage]]` — i.e. loads the
  **already-persisted, arbitrarily-long transcript** from the DB — then calls
  `assistantService.converse(history, message, user)`. This is exactly the `history` parameter
  `AssistantService.seedHistory`/`ClaudeClient.toApiToolRequest` operate on. Conversation persistence
  is not a future capability this design can discount — it is the very code path this change modifies,
  today, in this codebase.

Because this false claim is the *stated* justification for why the regression is acceptable without
further mitigation, D2a fails this round's explicit bar: "whether the accepted-trade-off reasoning is
actually sound and honestly stated, not hand-waved." Citing an already-shipped ticket as unshipped is
exactly the class of unverified-claim-presented-as-fact this ticket's own origin story (an assistant
proposing a nonexistent hostname) and the `verification-before-completion` Iron Law exist to catch —
here it has recurred inside the design document reviewing itself.

To be clear about scope: I do not think this invalidates the accepted-trade-off *decision* itself.
There is a correct, verifiable bound available that the design should state instead: `toApiToolRequest`
marks breakpoint (b) on `history.head` only (`ClaudeClient.scala:178-187`), and
`AssistantService.seedHistory` (`AssistantService.scala:105-111`) only ever *appends* a new turn to
`history` — it never rewrites `history.head`. So regardless of how many turns a real, persisted (HEL-663+)
conversation has accumulated, the content subject to breakpoint (b)'s prefix match is always just "tools
array + the conversation's original first turn (system prompt + its first user message)" — a size that
does not grow with conversation length or turn count. That is a real, code-verified bound; "HEL-663
hasn't shipped yet" is not, and must not stand as the stated reason.

### Verdict: REFUTE

### Change Requests

1. **Correct design.md D2a's false "later ticket" claim (line 92) and replace it with the actual,
   code-verified bound.** Required edits:
   - Remove "HEL-663 conversation persistence, which would grow it, is a later ticket" — HEL-663 is
     merged (`1c3c4688`, PR #341) and is an ancestor of this branch's HEAD; `AssistantConversationRoutes
     .converseFlow` already loads a persisted, potentially multi-turn transcript as `history` on every
     live `POST /assistant-conversations/:id/converse` call.
   - Replace the "bounded" justification with the real one: breakpoint (b) marks only `history.head`
     (`ClaudeClient.scala:178-187`), and `seedHistory` (`AssistantService.scala:105-111`) only ever
     appends — it never modifies or replaces `history.head` — so the prefix subject to a
     breakpoint-(b) cache miss stays fixed at "tools array + the conversation's original first turn,"
     independent of how long-running the conversation has become since HEL-663 shipped.
   - This is a text-only fix to D2a's stated reasoning (and, if it references the same claim verbatim,
     the Risks/Trade-offs bullet that points back to D2a) — it does not require reopening D1/D2/D3/D4,
     tasks.md, or the spec deltas, all of which I re-verified hold up this round.

### Non-blocking notes

- The round-1/round-2 non-blocking notes (`toolCallCount` not counting `web_search` invocations;
  `ClaudeApiContentBlock`'s new `Option[JsValue]` field for `web_search_tool_result`) remain accurate
  and still unaddressed in design.md — still low-risk, still correctly non-blocking.
- Once CR1 is fixed, I did not find anything else across `proposal.md`/`design.md`/`tasks.md`/the three
  spec deltas that would warrant another round on my read of the current state.
