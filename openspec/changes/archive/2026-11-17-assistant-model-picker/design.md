## Context

See proposal.md. Ground truth at 5bd0e7f94:
- `ClaudeConfig` holds one `model` (`CLAUDE_MODEL`, default `claude-opus-4-8`, line 37). `ClaudeClient.toApiToolRequest`
  and `toApiRequest` both write `model = config.model`. `wireTemperature` omits only the default 1.0 (HEL-1636 D7).
- `ClaudeApiResponse` (`ClaudeWireModels.scala:73`) does not decode the response's `model` field.
- The client never sends `thinking`, `top_p`, `top_k` or `tool_choice` (grep of `ClaudeProtocol.scala`).
- `assistant_conversations` (V80) has no model column. The transcript is a blob of `Seq[ClaudeToolMessage]`
  (repository format in `AssistantConversationRepository`), served raw to the frontend.
- HEL-1636 D4: `AssistantService.toTurnResult` drops `Thinking`/`RedactedThinking`/`Opaque` from persisted turns.
- `ChatAccessService.checkConverseCap` calls `AssistantDailyUsageRepository.incrementIfUnderCap(userId, limit)`,
  which adds exactly 1 (`message_count + 1 ... WHERE message_count < limit`).
- `users.preferences` JSON is patched by `PATCH /api/users/me/preferences` (`UserPreferencesRoutes`, allow-listed
  fields; `motion: null` clears) and returned on every auth response (`ApiRoutes.scala:367`).
- HEL-1741 added `domain/insights/InsightPriceTable.scala` with prices for the three 5.5 ids.
- helio-mcp has no converse tool. The converse contract is `schemas/assistant/converse-request.schema.json`.

API contract (platform.claude.com, fetched 2026-11-17, `evidence/api-contract.md`): the three ids are pinned with no
alias. All three reject `temperature`/`top_p`/`top_k` (Sonnet: "Sampling parameters return an error"). Adaptive
thinking is the default; `thinking.type = "enabled"` with `budget_tokens` is a 400 on all three; Opus thinking is
always on. Opus 5.5 and Sonnet 5.5 reject forced `tool_choice` with a 400. A thinking block the target model cannot
read is dropped silently, never a 400; the same-model prefix check can 400. Prefill is a 400 on all three.

## Goals / Non-Goals

Goals: one catalog both chat and insights read; per-conversation model with a per-turn record; user default; a
weighted beta counter (owner ruling); no API 400 from a model switch. Non-goals: proposal.md.

## Decisions

**D1 Shared catalog.** New `com.helio.infrastructure.ai.ClaudeModelCatalog` (next to `ClaudeConfig`, so both the
assistant and `domain.insights` can depend on it). `ClaudeModelSpec(id, label, betaWeight)`. Round-3 skeptic note (a): the `sendsSampling`/`allowsForcedToolChoice` flags are
DROPPED as dead data; the request rules (no sampling, no `budget_tokens`, never a forced `tool_choice` for any catalog
model, C17) are constants stated in the catalog's own doc comment and enforced by `ClaudeClient`. `ClaudeModelCatalog.fromEnv()` reads `CLAUDE_SELECTABLE_MODELS` (comma list, intersected with the catalog,
unknown ids WARN and are ignored, unset/empty/none-valid = all three) and `HELIO_BETA_MODEL_WEIGHTS`
(`id=n,...`; a malformed entry or `n < 1` WARNs and keeps that model's default). Lookup is `select(id):
Option[ClaudeModelSpec]`. A `ClaudeModelSpec` can only be obtained from the catalog, so a raw client string never
reaches the wire. Prices are not duplicated: a test asserts each selectable id has an `InsightPriceTable.Default`
entry. Rejected: moving `InsightPriceTable` into the catalog now (it collides with the active insight lanes).

**D2 Client takes a per-request model.** `ClaudeToolRequest` and `ClaudeRequest` gain `model: Option[ClaudeModelSpec]
= None` (existing call sites unchanged: `None` = `config.model`). `toApiToolRequest`/`toApiRequest` write
`spec.id`. `wireTemperature` returns `None` whenever the effective model is a catalog model (by spec, or by
`config.model` matching a catalog id), whatever the caller passed. No `thinking` field is ever added (adaptive is the
default). `ClaudeApiResponse` gains `model: Option[String]`; `FinalResponse`/`HopBudgetExhausted` carry the last hop's
`responseModel: Option[String]`. A response model that differs from the requested id logs one WARN (ids only).
`HttpClaudeTransport` logs its request-id line before the body is parsed, so after the parse the client logs one
correlated INFO line per hop: request-id, requested id, response `model`, `stop_reason` and the content block types
(types only, never content). D11 reads it. The model is fixed for the whole `sendWithTools` loop.

**D3 Effective model (one rule, server-side).** `effectiveModel(conversation, user)` = stored `conversation.model`
if still selectable, else the user default if still selectable, else the server default (`config.model`). A converse
uses `request.model` (validated) if present, else `effectiveModel`. "Catalog-defined" (has rules and a weight) is
distinct from "selectable" (in the narrowed allow-list): a server default that is catalog-defined but not selectable
still gets its catalog rules and weight; one that is not catalog-defined at all (the code default `claude-opus-4-8`)
is allowed as operator config with today's behavior and weight 1. A validated `request.model` is written to the
conversation in the same append as the turns. Resolution happens before the cap check so the weight is known.

**D4 Persistence (V140).** `V140__assistant_conversation_model.sql`: `ALTER TABLE assistant_conversations ADD COLUMN
model TEXT NULL;` (null = server default at send time). RLS unchanged. `create` stamps the user's selectable
default, else null. `UpdateAssistantConversationRequest` gains `model: Option[String]`; `PATCH` validates (400) then
saves; `model: null` clears it (back to the effective default). Summary and detail responses gain `model` (stored,
nullable) and `effectiveModel` (always present, from D3), so the client never re-derives the rule.

**D5 Per-turn record.** `ClaudeToolMessage` gains `model: Option[String] = None`. The route stamps every new assistant
message of the turn with `responseModel.getOrElse(resolved id)`. The repository format writes/reads `model`
(absent on old blobs). Turns supplied by a client (`POST /:id/messages`, `create.firstMessage`) have `model`
stripped, so the per-turn record is always server-stamped. `ClaudeClient` builds `ClaudeApiToolMessage` from role/content only, so it never reaches the
API. Rejected: a side table of turn models (the transcript is the single per-turn record and is already served raw).

**D6 Switching models.** Within a loop the model is fixed (D2). Across turns, persisted history has no thinking
(HEL-1636 D4), so no other model's thinking block can be sent. The fixtures are **synthetic**, hand-built from the
documented response shapes in `evidence/api-contract.md` (thinking with empty text + signature, `tool_use`,
`end_turn`), labelled per producing model; no real response body is stored (signatures are account-bound). Tests for
every ordered pair of the three models run turn 1 with thinking + tool use on model A and turn 2 on model B through
the real `AssistantService` + `ClaudeClient` with a recording fake transport. The fake returns 400 if a request holds
any thinking block not produced under that request's model in the same loop, or any sampling/`budget_tokens`/forced
`tool_choice` field. Because the fake encodes our reading of the docs, the real-API corroboration of both switch
directions is D11's switch conversation, not these tests.

**D7 Weighted beta counter (owner ruling Q1).** `incrementIfUnderCap(userId, limit, weight = 1)`:
`VALUES (..., weight) ON CONFLICT DO UPDATE SET message_count = message_count + weight WHERE message_count + weight
<= limit`, and `weight > limit` returns false without writing. `checkConverseCap(user, tier, weight)`; owner stays
uncounted. `guardAndCount` (authoring/refinement/pipeline AI on the server default) keeps weight 1.
`LimitReached` message names the model when the weight is above 1 ("Opus 5.5 needs 8 of today's units").

**D8 Model list endpoint.** `GET /api/assistant-models` (same tier guard as the conversation routes) returns
`{models: [{id, label, betaWeight}], serverDefault: {id, label?}, defaultModel: {id, label?}}`, where
`defaultModel` is the caller's resolved default for a new conversation (user default if selectable, else server
default), so the client never derives the rule. New schema
`schemas/assistant/assistant-models-response.schema.json`; `converse-request` and `assistant-conversation` schemas
gain `model`.

**D9 User default.** `UserPreferencesData.assistantModel: Option[String]`; `UserPreferencesRoutes` allows
`assistantModel` (selectable id or `null` clears, else 400, catalog injected). Reads drop a no-longer-selectable value.

**D10 Frontend.** Both pickers use the shared `frontend/src/shared/ui/Select.tsx` (DESIGN.md section 6, canonical,
portal-based); it and its placement helpers are consumed, never edited. HEL-1750 owns shared popover placement
(`ActionsMenu.tsx` and related files); if the composer placement needs a change there, it goes through the driver.
- Composer: a compact `Select` beside the send button. Its value is `effectiveModel`, and its options are the
  selectable models. When `effectiveModel` is not selectable (a non-catalog server default), one extra first option
  labelled "Server default (<id>)" is the shown value. Picking a model `PATCH`es the conversation (optimistic,
  reverted on error).
- No conversation yet (empty `/chat`, fresh start): the picker's value is `defaultModel` from D8. A pick is held in
  the slice and sent as `model` on the first `converse` in `startConversationWithMessage`; D3 persists it on the new
  conversation. The palette `/chat` hand-off has no picker and uses `defaultModel`.
- Picking the "Server default (<id>)" option `PATCH`es `model: null` (resolves through D3). After a Settings save the
  client refetches `/api/assistant-models` and the active conversation, so no stale `effectiveModel` is shown.
- Transcript: a muted model label under each assistant answer group (catalog label, else the raw id).
- Settings: an "Assistant" section, owner/beta only, with a `FormField` + `Select` for the default model and a
  "Server default (<serverDefault label or id>)" option that clears it. Tokens per DESIGN.md.

**D11 Live check (owner ruling Q2: cap $2, stop at projected $1.50).** Lane-port backend, dev account, every converse
pins `model`. One short tool-using turn per model, then one conversation Haiku -> Opus -> Haiku in which **every turn
is tool-using** (prompts that require a `find` call). For each hop record, from the D2 INFO line, the request-id,
the response model (asserted equal to the pinned id before the call counts), `stop_reason` and whether the response
carried a thinking block. Price usage from `InsightPriceTable.Default`. Stop if projected spend reaches $1.50. Delete conversations by exact id.

## Risks / Trade-offs

- [Opus thinking is always on and shares `max_tokens` 4096] → may end as `max_tokens` with no text (HEL-1636 D6 maps
  it to `NoAnswer`). The live check measures it; a per-model output cap is a follow-up if seen.
- [A weight above the remaining units denies a heavy model while a light one still fits] → intended; the message says so.
- [Prompt cache is per model] → a switch pays one cold cache write; accepted.

## Planner Notes

- Owner rulings: Q1 weights 1/4/8 env-overridable, owner uncounted; Q2 $2 cap stop at $1.50. V140 is driver-confirmed.
- Self-approved: D1-D10 internals, the env var names, the list endpoint.
- skeptic-design-1: CR1 (shared `Select`), CR2 (schemas), CR3 (`effectiveModel`), CR4 (synthetic fixtures + live
  corroboration) adopted; notes on the post-parse INFO line, stripping client-supplied `model`, and catalog-defined vs
  selectable adopted. HEL-1740 consuming `ClaudeModelCatalog` is driver coordination.
- skeptic-design-2: CR1 (no-conversation picker: D8 `defaultModel`, pick sent on first converse) and all notes adopted.
