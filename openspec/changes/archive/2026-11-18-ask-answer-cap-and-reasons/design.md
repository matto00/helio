## Context

- `AskDataService.MaxAnswerTokens = 1024` is sent as `ClaudeToolRequest.maxTokens` on every hop of both the main loop and the
  corrective turn. `ClaudeClient` clamps it to `config.maxOutputTokens` (`CLAUDE_MAX_TOKENS`, default 4096; not set by
  `infra/` or `.github/`).
- Anthropic docs (platform.claude.com, read 2026-11-18): "`max_tokens` is a hard cap on total output for the request,
  thinking and response text combined" (thinking-steering-and-cost); on Haiku 5.5 "Thinking is on by default and counts
  toward `max_tokens`, so leave room for it" (effort); in a tool loop "each request in the turn has its own
  `max_tokens`"; a value "sized for a response with no thinking is often too small". Remedies listed for
  `stop_reason: max_tokens`: raise `max_tokens`, or lower effort. No page gives a minimum; the effort page's example is 4096.
  The docs do not explicitly describe a thinking-only `max_tokens` response; `ClaudeClient` already treats one as a case
  (`noVisibleText && stop_reason == max_tokens` -> `Failed(NoAnswer)`), and the HEL-1745 skeptic saw live `thinking,text` hops.
- Today a thinking-only `max_tokens` hop -> `Failed(NoAnswer(Some("max_tokens")))` -> `AskError.Failed(BadGateway)` -> `502`.
  A `max_tokens` hop with partial text -> `FinalResponse(partialText)` -> validated -> possibly returned truncated.
- `InsightValidator` reasons quote values: `numeral '99' does not match ...`, `date '2026-11-30' does not match ...`,
  plus marker / length / sentence-count reasons with counts. The route returns them verbatim in the `422` body.
- `AskPinBuilder` uses `node.rootId.getOrElse(node.pipelineId)` when `stepId` is None. The test fixture's root id equals
  the pipeline id (`OutputHistoryFixtures.seedPipelineWithOutput`), so the existing pin test cannot tell the two apart.
  V98 backfilled each pre-existing pipeline's root with `id = pipeline id`, so the fallback names a real root.

## Goals / Non-Goals

**Goals:** no `502` and no truncated answer from a `max_tokens` stop; a cap sized for thinking; digit-free public
reasons; a pin test that distinguishes the real root id from the fallback.

**Non-Goals:** no `effort` / `output_config` parameter (the HEL-1755 catalog rules govern the wire shape; adding a
request field is a separate decision); no retry on truncation; no live model call; no frontend; no migration; no change
to `InsightValidator` itself (other consumers rely on its wording).

## Decisions

**D1. Cap 4096, constant in `AskDataService`.** The docs also say "At high and above, set a large max_tokens", and the
API default effort is high for the Opus family, which matters only where `CLAUDE_MODEL` is not Haiku 5.5 (the local
code default is `claude-opus-4-8`; prod pins Haiku 5.5, default effort medium). Going above 4096 would need a
`CLAUDE_MAX_TOKENS` change anyway, since that is the default clamp. Chosen over a new env var (no operator need yet) and over 16000 (the
answer is at most 1200 characters / 6 sentences, so the text part is small; 4096 is the docs' own example, equals the
default clamp, and leaves ~3.5k tokens for thinking). Rename stays `MaxAnswerTokens` or `MaxHopTokens`, executor's call.

**D2. Truncation is `422 ASK_ANSWER_TRUNCATED`, no retry.** A retry would re-run the whole tool loop (the `Failed`
outcome carries no history) and re-spend tools and tokens on a question that already exceeded the room; a narrower
question is the user's fix. `422` over `503`: the outcome is a property of this question, not a transient outage.
Body: `{message, code: "ASK_ANSWER_TRUNCATED"}` (a new small response type in `AskProtocol`, since `ErrorResponse` is
`{message}` only) with a message such as "The answer ran out of room before it finished;
ask something narrower". New `AskError.Truncated` case; the route maps it. Not charged differently (the charge is taken
before the ask, as today).

**D3. Detect both truncation shapes.**
- Thinking-only: `ClaudeToolOutcome.Failed(ClaudeError.NoAnswer(Some("max_tokens"), _))` -> `Truncated`. `pause_turn`
  keeps today's mapping (web search is off for ask, so it should not occur).
- Partial text: `FinalResponse` gains the final hop's `stop_reason` in its SECOND parameter list
  (`(val responseModel: Option[String] = None, val stopReason: Option[String] = None)`), set by `ClaudeClient` from
  `apiResponse.stopReason`. Second-list fields are not in `unapply`, so the 19 existing `FinalResponse(...)` patterns and
  constructions compile unchanged. `AskDataService` checks `stopReason.contains("max_tokens")` BEFORE validation on both
  the main hop and the corrective hop -> `Truncated`.
- Scope (skeptic design-1 item 1, option a): only hops that END the loop (no `tool_use`) are detected. A hop that stops at
  `max_tokens` while carrying a (possibly cut-off) `tool_use` keeps today's behaviour: `ClaudeClient` runs the executor with
  that input, the ask executor re-checks scope on every call (a malformed or cut-off input becomes an error result), and
  the loop continues; `logHop` records its `stop_reason`. No change to the shared `ClaudeClient` loop, so
  `AssistantService` is unaffected. The spec sentence is narrowed to match.
- Both paths log one WARN `Ask hop stopped at max_tokens (thinking-only|partial-text)` with no answer text. This plus
  `ClaudeClient.logHop`'s existing per-hop `stop_reason`/usage INFO line is the measurement instrument.

**D4. Measurement position (ticket item 1).** Not measured. There is no ask traffic to measure: no frontend calls the ask
routes yet (grep of `frontend/src`), and no live calls are approved for this ticket. A fake transport cannot measure a
real distribution. The cap is sized from the docs (D1) and the outcome is made clean (D2/D3); the WARN line makes
frequency countable once L5/L7 put traffic on it. This is stated in the PR body, not hidden.

**D5. Public reasons are categories.** `AskError.Ungrounded` carries `reasons` (full, used for the corrective prompt and
logs-by-count only) and the route emits `publicReasons`: each reason mapped by prefix to a fixed phrase
(`a number is not backed by a cited value`, `a date is not backed by a cited date`, `a citation marker is not in the
data`, `the answer is too long`, `the answer has too many sentences`, `the tool-call budget was reached before an
answer`), deduplicated; any unrecognised reason maps to `the answer could not be checked against the data`. A final
guard strips any digit from the output. Mapping lives in the ask package (e.g. `AskReasons.publicOf`), not in
`InsightValidator`. Chosen over dropping `reasons` because the field is documented in CLAUDE.md and keeping the shape
costs nothing.

**D6. Pin fallback test.** Unit-level tests of `AskPinBuilder.build` with constructed `Output` values (real
`AccessChecker` from the harness, owner caller): (a) `rootId = Some(distinctRootId)` -> pin `rootId` is that id, not the
pipeline id; (b) `stepId = None, rootId = None` -> pin `rootId` is the pipeline id. Plus one round trip: (b)'s pin body
created through the real `OutputService.create` on a pipeline whose root id equals its pipeline id (the V98 shape)
succeeds as kind `insight`. Red evidence for an already-correct branch is by mutation: replacing the fallback with
`first.node.stepId`/omitting `rootId` and replacing `rootId.map(...)` with the pipeline id each turn one test red.

## Risks / Trade-offs

- Worst-case output spend per hop is 4x. Output is billed as used; typical answers are short.
- A legitimately long but finished reasoning hop that still exceeds 4096 now gets `422` instead of `502`; same failure
  frequency, clearer outcome.
- A `max_tokens` stop on a tool-call hop is not treated as truncation (D3 scope); a cut-off tool input becomes an error
  result through the existing executor path, and the model gets another hop if the budget allows.
- `FinalResponse` gains a field: other consumers ignore it. If a consumer later wants the same truncation rule, it is a
  separate ticket.
