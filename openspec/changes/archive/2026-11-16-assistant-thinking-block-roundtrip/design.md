## Context

See proposal.md (Why). Ground truth, read from the tree at 4540b3c91:

- `ClaudeProtocol.claudeApiContentBlockFormat.read` reads `text`, `tool_use`, `server_tool_use`, `tool_result` and
  `web_search_tool_result`. Every other type falls to `case _`, which keeps only a `text` field.
- `ClaudeClient.toContentBlock` (`ClaudeClient.scala:182-183`) maps every other type to `Text(b.text.getOrElse(""))`.
- `sendWithTools` folds every block of a response into the assistant turn it sends back on the next hop.
- `AssistantService.converse` returns `fullHistory`. `AssistantConversationRoutes.converseFlow` persists
  `fullHistory.drop(history.length)` through `AssistantConversationRepository.claudeContentBlockFormat`. A later
  `converse` reads it back as the next request's prefix.
- `ActiveConversationPanel.tsx` renders every `text` block as a `MessageTurn` and returns `null` for any other type.
- Turn 1 sends the system prompt folded into the first user turn. `desanitizeFirstTurn` persists that turn without it,
  and turns 2+ never add it back (filed as HEL-1718). So the request prefix changes between turn 1 and turn 2.

The Anthropic API contract this design relies on is in `evidence/api-contract.md`: official docs, fetched
2026-11-16, quoted with URLs. That covers block shapes, the round-trip and prefix-binding rules, the refusal shape,
Haiku 5.5 sampling, prefill and `max_tokens`, and pricing. On our `anthropic-version: 2023-06-01`, a default
`temperature` is accepted, which is why prod's first message worked.

## Goals / Non-Goals

**Goals:** a byte-exact round trip of model-internal blocks within one tool loop; no empty text block ever on the
wire; persisted history that is valid for any model; a refusal or empty answer surfaces as an error.

**Non-Goals:** see proposal.md. In addition, there are no new streaming event types. `ClaudeSseFrameParser` already
drops `thinking_delta`/`signature_delta`, and that is verified, not changed.

## Decisions

**D1 Wire decode keeps every block.** `ClaudeApiContentBlock` gains `thinking`, `signature` and `data`
(`Option[String]`) and `raw: Option[JsObject]`. `read` gets explicit cases:
- `thinking`: keep `thinking` and `signature` exactly. An empty string stays `Some("")`.
- `redacted_thinking`: keep `data`.
- `text`: keep `text`.
- Any other type: `raw = Some(<the whole object>)`, `text = None`.

`write` emits the same fields back. A `raw` block is written verbatim, so unknown fields survive.
Alternative rejected: one generic raw JSON for every type. It would lose the typed `text`/`tool_use` handling that
callers depend on.

**D2 Domain blocks.** Three new cases go in the sealed `ClaudeContentBlock` in `ClaudeModels.scala`; Scala requires
sealed subclasses in the same file. The cases are `Thinking(thinking, signature)`, `RedactedThinking(data)` and
`Opaque(blockType, raw: JsObject)`. `toContentBlock` gets an explicit `"text"` case. Every other unrecognised type
becomes `Opaque`, with one WARN naming the type and never the content. `toApiContentBlock` maps each new case back
unchanged. `flattenForEstimate` counts thinking text, data and raw. `extractText` stays text-only, so thinking is
never answer text. HEL-1639 edits `ClaudeToolRequest` in the same file. These are separate hunks; keep the new cases
and their docs inside `object ClaudeContentBlock` / `object ClaudeError`.

**D3 Tool loop round-trips unchanged while the prefix is unchanged.** The in-loop `history` in `sendWithTools` keeps
D2 blocks exactly as decoded. The next hop's request writes them back byte-equal: same order, the empty `thinking`
kept, the same `signature`. This is the docs' "Required" rule.

**D3a Prefix change strips all earlier thinking (skeptic-design-1 CR1).** The prefix-check page says thinking blocks
are bound to `system` + `tools` + the earlier messages. A change to any of them can 400 on Haiku 5.5 with "Invalid
`signature`". The same page says you may leave out all of them. `toApiToolRequest` already shrinks the `web_search`
entry's `max_uses` after a hop that searched, and removes it once the budget is spent (HEL-757). So `sendWithTools`
tracks the previous hop's outbound `tools` and applies one rule, `stripAllThinking`. It rewrites the loop's carried
`history` itself, not only the outbound request. It removes every `Thinking`/`RedactedThinking` block present at
that point, so no block produced before the strip is ever sent again in that loop (skeptic-design-2 CR2). The rule
fires when either:
- this hop's `tools` differs from the previous hop's (compare the serialized JSON); or
- D5's normalisation would change a message that contains a thinking block.

Later hops then keep only the blocks produced after the change, and those blocks are bound to the new prefix.
`Opaque` blocks are not signed and are left as they are.

Rejected options:
- (a) Keep `tools` byte-stable by sending `WebSearch(config.webSearchMaxUses)` on every hop. `max_uses` is
  per-request, so a turn could run up to `webSearchMaxUses x (maxHops + 1)` searches. That breaks HEL-757's
  cross-hop cost cap, which the owner set.
- (c) The beta `thinking-binding-controls-2026-08-01` with `drop_block`. It adds a beta header dependency, is
  documented only for adaptive-thinking models, and does the same thing as (b) server-side.

Cost of (b): after a web search, earlier thinking is lost. The docs say this "loses the reasoning ... even without an
error". That is the same class of accepted risk as D4.

**D4 Persisted history drops model-internal blocks.** `AssistantService.toTurnResult` removes `Thinking`,
`RedactedThinking` and `Opaque` blocks from every turn of the `fullHistory` it returns. It keeps the number of turns
the same, because the route slices by `history.length`. Why drop rather than keep:
1. The changing first-turn prefix (HEL-1718) would make kept Haiku 5.5 signatures fail with a 400 on turn 2.
2. Signatures are encrypted reasoning, and nothing in the browser needs them. The transcript is served raw to the
   frontend.
3. Dropping every prior-turn block satisfies "not a block between two you keep".

The repository format still gets write/read cases for the three blocks (`thinking`, `redacted_thinking`, `opaque`).
This keeps the sealed match exhaustive and prevents a crash if one ever reaches persistence. Dropping happens in
`toTurnResult`, not the repository, so the drop decision sits in the assistant layer with the history semantics.

**D5 No empty text on the wire.** `toApiToolRequest` normalises the outbound messages before the cache marker is
placed:
- drop every `Text` whose text is blank (empty or whitespace only, one shared `isBlank` predicate also used by D6 and D10);
- drop a message left with no blocks;
- merge consecutive same-role messages that this creates, joining their blocks.

`toApiRequest` (`send`/`stream`, string content) applies the same rule: drop a message whose content is empty, and
join same-role neighbours with a blank line (skeptic-design-2 CR3b). The "no empty text block" invariant then
holds for every request the client sends. A merge can put user text right after a `tool_result`, which the
stop-reasons page names as a cause of empty `end_turn`. That is rare and tolerated under D6. If any tool-request
message altered here holds a thinking block, D3a's `stripAllThinking` applies to the whole request. This is
never a partial edit of a signed message (skeptic note 2). In practice D5 only fires on legacy persisted turns, and
those never hold thinking.

This repairs transcripts already persisted with `Text("")` (prod conversations from 2026-10-16 on). It is a client
invariant for every caller. Alternative rejected: repair stored blobs with a migration. That means an unbounded blob
rewrite for a read-time fix.

**D6 No-answer is a typed error, on every path (skeptic-design-1 CR2).** A new case,
`ClaudeError.NoAnswer(stopReason: Option[String], category: Option[String])`. `ClaudeApiResponse` gains
`stopDetails: Option[JsValue]`, parsed from `stop_details`, and `category` is read from it.

When it fires (narrowed by skeptic-design-2 CR1):
- `sendWithTools` returns `Failed(NoAnswer)` on any hop whose `stop_reason` is `refusal`. It also returns it when a
  response without `tool_use` has no non-empty `Text` and its `stop_reason` is `max_tokens` or `pause_turn`.
- An `end_turn` with no text stays `FinalResponse("")`. The docs say Claude may end a turn with empty content,
  "particularly after tool results". That is the assistant's main path: `propose_*`, then end the turn.
- `AssistantService.toTurnResult` turns `FinalResponse` with blank text and no `executor.proposal` into
  `Left(NoAnswer(Some("end_turn"), None))`. With a proposal, the turn succeeds and is persisted. Its final assistant
  turn may be empty after D4, and D5 drops that turn from later requests.
- `send` returns `Left(NoAnswer)` on `refusal`, or on any response with no non-empty text, whatever the stop reason.
  It has no tool hops, and every `send` caller needs text. D11 moves every `ClaudeClient` consumer onto Haiku 5.5,
  not only the assistant.

User-facing messages:
- refusal: "Claude declined this request (category: <c or unspecified>). Rephrase it and try again."
- `pause_turn`: "Claude paused a long search before answering. Send your message again to continue."
- otherwise: "Claude returned no answer (stop_reason: <r>)."

Error mapping by site:
- `AssistantConversationRoutes.mapClaudeError` returns `BadGateway(<message>)`. `Failed` already persists nothing.
- `DashboardAuthoringService.mapClaudeError` and `RefinementService.mapClaudeError` return
  `AuthoringError.kinded(ModelFailure, BadGateway(<message>))`.
- `ClaudeAiStepClient` returns `AiStepFailure.Api(0, <message>)`. Status 0 is the existing "no HTTP status" sentinel
  (see `ClaudeError.ApiError`'s doc). A pipeline AI step then fails loudly instead of writing `""`.

`stream` is unchanged, but its consumer is not (skeptic-design-2 CR3a). A refusal streams no text deltas, so
`DashboardAuthoringService.completeStream` gets `""`. Today that triggers a repair request carrying an empty
assistant message. From now on, a blank `fullText` ends the stream with a `failStreamEvent` built from
`mapClaudeError(NoAnswer(None, None))`, and no repair call is made. A test asserts that no repair `send` happens.

**D7 Default temperature omitted.** `ClaudeApiRequest`/`ClaudeApiToolRequest.temperature` becomes `Option[Double]`.
The client sends `None` when the resolved value is `1.0`, the API default, and the protocol omits the field on
`None`. An explicit non-default `CLAUDE_TEMPERATURE` or a per-call override is still sent, so other models behave
the same. `top_p`/`top_k` are never sent, and a test pins this. `ClaudeConfig.fromEnv` logs one WARN when the model id
starts with `claude-haiku-5` and the temperature is not 1.0. Haiku 5.5 rejects non-default sampling (skeptic note 5).

**D8 Prefill guard.** `seedHistory` always ends with a user turn. A test pins this for a fresh conversation, a
continued one, and one that has a dangling `tool_use`.

**D9 Request-id logging.** `HttpClaudeTransport` logs one INFO line per response: status and the `request-id` header
value only. It never logs the body or headers that carry the key. This makes the live check, and prod 400s,
traceable.

**D10 Frontend.** `ActiveConversationPanel` renders no `MessageTurn` for a text block whose text is empty or
whitespace. This fixes the empty bubble in transcripts saved before this fix. The `lastTurnHasTrailingText` check
uses the same predicate.

**D11 Deploy pin (owner ruling Q1).** `CLAUDE_MODEL=claude-haiku-5-5` goes in `cd-backend.yml:99`
(`--update-env-vars`) and `deploy-backend.sh:120` (`--set-env-vars`). Their comments are updated. The `CLAUDE.md`
row keeps the default `claude-opus-4-8`, which matches `ClaudeConfig.DefaultModel`, and names the prod pin.

**D12 Live check (owner ruling Q2, cap $2; skeptic-design-1 CR3).** Start a local backend on this lane's ports with
`CLAUDE_MODEL=claude-haiku-5-5` exported. The shell value wins over `.env` (`DevEnv.runEnv`), and the key comes from
the app's own `.env` loading, which no agent reads. Run converse calls as the dev account in two conversations.

- **Conversation A** (two messages): message 1 asks about the user's workspace, so at least one `find` tool hop is
  likely. Message 2 must succeed. This is the original prod failure.
- **Conversation B** (web search): one message whose wording makes a `web_search` likely, for example asking for a
  current public fact plus a dashboard suggestion. It must reach at least one more hop after the search in the same
  turn, which exercises D3a.
  - Confirm from the logged request-ids and the persisted transcript (`server_tool_use` blocks) whether a search
    actually happened.
  - If the model did not search, allow one retry with a more explicit prompt. If it still did not search, report web
    search as UNEXERCISED. Never report it as passed.

Record every request-id, the per-turn usage (`AssistantTelemetry` tokens) and the search count. Compute cost from the
official Haiku 5.5 pricing in `evidence/api-contract.md`; the expected total is under $0.10. If the projected spend
reaches $1, stop. Never call it in a loop.

## Risks / Trade-offs

- [Dropping thinking from a persisted HopBudgetExhausted turn whose `tool_use` the next `converse` resolves with a
  synthetic `tool_result`] → The docs mark tool-turn thinking as "required". Keeping it would fail the prefix check
  on turn 1 (HEL-1718). This is accepted and named. The live check must report it if seen. It is rare: it needs the
  hop cap.
- [`Opaque` blocks sent back verbatim within a loop could be types the API refuses as input] → They are the API's
  own output, sent back unmodified, which is the documented contract for model output. Accepted.
- [The D5 merge changes the shape of history] → It only runs when a legacy empty-text-only turn exists. It is
  covered by a test.
- [D3a strips earlier thinking after any web search] → Earlier reasoning is lost for the rest of that turn. There is
  no 400. This is covered by a fixture test and exercised live in Conversation B.
- [`Opaque` blocks stripped from persisted turns could orphan a future server-tool result paired with a kept
  `server_tool_use`] → Only `web_search` is offered, and its result type is modelled. A code comment at the strip
  site says so (skeptic note 4).
- [The 4096 `max_tokens` is shared with thinking] → D6 turns an exhausted turn into an error instead of an empty
  answer. Raising the cap or setting effort is a follow-up if the live check shows it.

## Planner Notes

- Skeptic note 1 (rewrite HopBudgetExhausted turns) is declined: it changes the established synthetic-`tool_result`
  behavior for a rare path, and the docs show no 400 for it.
- Self-approved: D1-D10 are internal and within the ticket's stated fix direction. D11 and D12 are owner-ruled.
- The design runs past the 150-line guide (about 190 lines) after the round-1 revisions (D3a, D6 on `send`, D12).
  The API contract detail was moved to `evidence/api-contract.md` to keep it down.
- Skeptic-design-3 notes: 2 (one `isBlank` predicate) and 3 (spec names a final response, not a hop-budget stop)
  adopted. Note 4 (a `find`-empty turn ending in an empty `end_turn` is now a 502) goes in the PR body as an intended
  behavior change. Note 1: expect a small textual conflict with HEL-1639 near the recursive `loop` call.
- No Flyway migration (V138 stays free). No JSON schema or API contract change: the transcript stays opaque `JsValue`.
- Red-first: the tests for D3, D4/D5 and the guard are committed and run red on the unfixed code, then fixed.
  Fixtures are hand-built from the documented response shapes and contain no secrets.
