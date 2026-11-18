## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD c03fc0a4ad97b1dd17000c0fa2a543e37b57cce5 (planning artifacts are uncommitted in the change dir).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/ask-answer-token-cap/HEL-1761`.
- **Ticket provenance:** the HEL-1745 `skeptic-final-1.md` lines 55-58 name exactly the three gaps (pin fallback untested, 422 reasons echo numerals, thinking with a 1,024 cap -> 502).
- **Current behaviour as described in design.md Context: confirmed.**
  - `AskDataService.scala:38` `MaxAnswerTokens = 1024`, sent as `maxTokens` on both the main request and the corrective request (`request(...)`).
  - `ClaudeClient.scala:138-142`: with no tool_use, `noVisibleText && stop_reason in {max_tokens, pause_turn}` -> `Failed(noAnswer(...))`; otherwise `FinalResponse(extractText(blocks), ...)(apiResponse.model)`. So a thinking-only `max_tokens` hop is `Failed(NoAnswer(Some("max_tokens"), _))`, which `AskDataService.failure` maps to `BadGateway` -> 502. A `max_tokens` hop with partial text becomes a normal `FinalResponse` and goes to validation, so a truncated answer can be returned. Both paths are as design D3 describes.
  - Clamp: `ClaudeClient.scala:402` `math.min(request.maxTokens.getOrElse(max), config.maxOutputTokens)`. Raising the cap to 4096 is effective only up to `CLAUDE_MAX_TOKENS` (default 4096). The design says this.
  - `AskRoutes.scala:56-60` returns `reasons` verbatim. `InsightValidator.scala:23,25,27,68,73` reasons quote the marker id, character and sentence counts, `date '...'` and `numeral '...'`. D5's prefix list covers all of them. "the text is empty" falls into D5's catch-all, which is acceptable.
  - `AskPinBuilder.scala:36` `rootId.map(_.value).getOrElse(pipelineId)`. `NodeRef(pipelineId, stepId: Option, rootId: Option = None)` (`model.scala:602`).
- **"19 FinalResponse sites compile unchanged": confirmed.** `grep -rn "FinalResponse("` lists 18 use sites plus the definition. Breakdown: 3 pattern sites in main, 1 construction site in `ClaudeClient:142` (positional `(apiResponse.model)`), 11 test patterns, and `AssistantService`'s `r @ FinalResponse(...)` followed by `r.responseModel`. Scala 2.13.15. Second-list fields are excluded from `unapply`. Adding a defaulted second parameter after `responseModel` keeps every positional or empty second-list call valid. No `.copy(` call on `FinalResponse` exists anywhere.
- **Docs quotes:** I fetched platform.claude.com `build-with-claude/effort` and `extended-thinking`.
  - Confirmed: "It's a hard limit on total output (thinking plus response text)".
  - Confirmed for Haiku 5.5: "Thinking is on by default and counts toward max_tokens, so leave room for it". Haiku 5.5's default effort is medium.
  - Confirmed: "Set max_tokens with room for thinking and the reply".
  - Confirmed: the effort-page code examples use `max_tokens: 4096`.
  - Extra finding: the page also says "At high and above, set a large max_tokens". The API default effort is high for the Opus/Fable families. That matters only where `CLAUDE_MODEL` is non-Haiku (the local default is `claude-opus-4-8`; prod pins Haiku 5.5).
- **Product-call question.** The ticket offers "size the cap or handle `stop_reason: max_tokens` cleanly, with one bounded retry or a clear 422/503".
  - "422, no retry" and a sized cap are both within those stated options, so this is not an uncovered product call and no escalation is needed.
  - The new code name `ASK_ANSWER_TRUNCATED` has no consumer yet: grep of `frontend/src` finds no ask client.
  - AC3 ("no longer 1024", rationale stated, measurement position stated without a live call) is covered by D1/D4.
- **Pin fallback reachability.** V98 backfilled `pipeline_roots` with `id = pipeline id` and set `outputs.root_id = pipeline_id` wherever `node_step_id IS NULL`. Post-V98 creates fill the root via `firstRootIdAction` (`OutputRootResolution.scala`). The "neither" case is therefore essentially unreachable from the DB, and the fallback names a real root (`resolveExplicitRootId` accepts it). D6's unit-level construction of the `Output` is the right way to reach it.
- **Schemas:** `schemas/ask/*.json` contain no 422/reasons shape (grep count 0), so no schema delta is needed. CLAUDE.md:174 documents `422 {code: "ASK_UNGROUNDED", reasons}`; task 2.4 updates it.
- **Spec delta:** both MODIFIED requirements match the base headers in `openspec/specs/ask-your-data/spec.md`, and each carries its full prior text plus the additions.

### Verdict: REFUTE

### Change Requests

1. **Spec and design disagree on which hops count as "truncated". An implementer can read this two ways.**
   - The spec delta says: "A hop that stops with `stop_reason: max_tokens` SHALL end the ask with `422` code `ASK_ANSWER_TRUNCATED`". That covers every hop.
   - D3 only detects the two shapes that end the loop: `Failed(NoAnswer)`, and `FinalResponse` with `stopReason`.
   - A third shape exists and neither artifact decides it: a hop that stops at `max_tokens` while emitting a `tool_use` block. At 4096, a thinking + tool_use hop can be cut off mid-input. `ClaudeClient.scala:134` only treats `toolUses.isEmpty` as final. A truncated tool_use goes to the `else` branch: the executor runs with the truncated input, and the loop continues. That does not end the ask with 422, so the spec as written would be violated, or the executor would have to change shared `ClaudeClient` loop code (also used by `AssistantService`) on its own judgment.
   - Required: make the two agree and state the decision.
     - (a) Narrow the spec sentence to "a hop that ends the loop (no tool call)" and add one Risks line saying a truncated tool_use hop keeps today's behaviour (the executor gets the truncated input, scope is still re-checked, and `logHop` records the `stop_reason`).
     - Or (b) design and test its detection: where (ClaudeClient or ask-local), how `AssistantService` is unaffected, and a red test.
   - Either is fine. Leaving it undecided is not.

### Non-blocking notes

- The spec scenario "Partial answer at the cap" is phrased at the response level ("the response is `422`"), but tasks only plan the service-level test (1.2) and a route test for the thinking-only shape (1.4). Consider a route-level partial-text case in AskRoutesSpec so the scenario's "does not contain that text" is checked on the wire body.
- The spec says an Output with neither step nor root id was "written before V98". V98 itself backfilled those rows. More precisely, this is a defensive fallback for a row with a null `root_id`, which V98's backfill should have eliminated. This is wording only.
- D1 rationale: worth one sentence that a non-Haiku `CLAUDE_MODEL` defaults to high effort, where the docs say "set a large max_tokens". 4096 is also the default clamp, so going higher would need an env change anyway. This supports D1's choice, but it should be said rather than left implicit.
- D2's `422` body `{message, code}` needs a response type (`ErrorResponse` is `{message}` only). The proposal leaves this as "if a response type is added". Either is fine.
