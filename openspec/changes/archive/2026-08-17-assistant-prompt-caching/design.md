# Design: assistant-prompt-caching

## Context

`HttpClaudeTransport.buildHttpRequest` serializes `ClaudeApiRequest`/`ClaudeApiToolRequest` via `ClaudeProtocol`'s
hand-written snake_case writers. `ClaudeClient.sendWithTools`'s `loop` re-sends `toApiToolRequest(request, history)`
every hop — `tools` and the whole prior history are byte-identical between hops. `AssistantService.seedHistory` folds
`AssistantSystemPrompt.text` into the first user turn (no separate `system` field on `ClaudeToolRequest`), so the
first turn is the system-prompt carrier. `ClaudeApiUsage` parses only `input_tokens`/`output_tokens` today;
`AssistantTelemetry.emitToolLoopOutcome` logs the aggregated `TokenUsage`. Verified: `TokenUsage` has no spray
formatter anywhere and never reaches an HTTP response — `AssistantConversationRoutes.converseFlow` threads
`result.usage` into telemetry only.

## Goals / Non-Goals

**Goals:** cache breakpoints on the stable prefix for `send` and `sendTool`; cache-token counters parsed, aggregated,
and logged; byte-identical serialization for every request that sets no marker.

**Non-Goals:** per-hop incremental history breakpoints; `AuthoringTelemetry` changes; config toggles; frontend/schema
changes; any behavior change to conversation output.

## Decisions

### D1 — Model `cache_control` as an optional wire field with a default, not a Boolean

Add `final case class ClaudeApiCacheControl(cacheType: String)` (companion `val Ephemeral =
ClaudeApiCacheControl("ephemeral")`) to `ClaudeWireModels.scala`, and `cacheControl: Option[ClaudeApiCacheControl] =
None` to `ClaudeApiContentBlock`, `ClaudeApiTool`, and `ClaudeApiMessage`. Rationale: the file's own doc comment says
these types "mirror the Anthropic Messages API's own JSON shape", and the API value is an object (`{"type":
"ephemeral"}`, future TTL variants exist) — a bare Boolean would break that mirroring. Default-`None` follows the
exact precedent `ClaudeApiContentBlock` itself set for the tool-use fields ("all default `None` so every existing
construction site keeps compiling and behaving unchanged"). Alternative rejected: marking in a wrapper type around
the request — spreads a wire concern into new types for no gain.

### D2 — Writers append `cache_control` only when set; readers ignore it

`ClaudeProtocol` writer changes: `claudeApiContentBlockFormat.write` appends `"cache_control" -> JsObject("type" ->
JsString(...))` for any block type when `cacheControl` is `Some` (works for the `tool_result`+`text` first-turn shape
`seedHistory` can produce); `claudeApiToolFormat.write` likewise. `claudeApiMessageFormat` becomes a hand-written
`RootJsonFormat` (it is `jsonFormat2` today): when `cacheControl` is `None`, `content` stays a plain `JsString`
(byte-identical to today); when `Some`, `content` is written as a one-element `text` block array carrying
`cache_control` — the Messages API accepts string-or-block-array content interchangeably, so semantics are unchanged.
`read` sides ignore the field: Anthropic responses never carry `cache_control`, and the message format's `read` is
kept for symmetry with its current macro behavior (content read as string). No change to `ClaudeApiRequest`/
`ClaudeApiToolRequest` writers themselves — the markers ride on their children.

### D3 — Breakpoints are placed in `ClaudeClient`'s builders, not in services or the transport

`toApiToolRequest`: after building, mark the last element of `tools` (when non-empty) and the last content block of
the first message (when messages non-empty) with `Ephemeral`. `toApiRequest`: mark the first message. Rationale:
domain types (`ClaudeToolMessage`/`ClaudeContentBlock`) stay wire-agnostic; every caller of `send`/`stream`/
`sendWithTools` benefits without change; the transport remains a dumb serializer. Marking the first message's *last*
block (not first) maximizes the cached span of the first turn. `stream` sharing `toApiRequest` with `send` is
deliberate: the API supports caching on streaming requests identically, and a builder-level split would be artificial.
Anthropic allows up to 4 breakpoints; this design uses at most 2.

### D4 — Cache-token counters ride the existing usage path end to end

`ClaudeApiUsage` gains `cacheCreationInputTokens: Int = 0` / `cacheReadInputTokens: Int = 0`;
`claudeApiUsageFormat.read` parses `cache_creation_input_tokens`/`cache_read_input_tokens` with the existing
`.map(_.convertTo[Int]).getOrElse(0)` absent-tolerant idiom (the API omits them when caching is off), and `write`
emits them for symmetry. Domain `TokenUsage` gains the same two default-0 fields; `ClaudeClient.addUsage` sums all
four; `toClaudeResponse` maps them. Callers constructing `TokenUsage(a, b)` (e.g. `sendWithTools`'s seed,
`DashboardAuthoringService.runRepair`) compile unchanged via defaults. Alternative rejected: logging per-hop
`ClaudeApiUsage` inside `ClaudeClient` — the aggregate on the existing telemetry event is what the AC asks for, and a
per-hop client log would fire for every caller, not just the assistant.

### D5 — Telemetry: two new fields on the existing event, nothing else

`AssistantTelemetry.emitToolLoopOutcome` appends `"cacheReadInputTokens"`/`"cacheCreationInputTokens"` from `tokens`
to the existing MDC field vector. A multi-hop turn logs nonzero `cacheReadInputTokens` (AC #2): hop 1 writes the
prefix cache, hops 2/3 read it. The privacy stance in the object's doc comment is unaffected — token counts only.

### D6 — Verification strategy

`HttpClaudeTransport.buildHttpRequest` is `private[ai]` precisely for request-shape assertions: extend
`HttpClaudeTransportSpec` to assert the serialized entity carries `cache_control` on the last tool and the first
message (both paths), and that an unmarked request's JSON is unchanged. `ClaudeClient` specs (stub transport,
existing SPI pattern) assert breakpoint placement in built requests and 4-field usage aggregation across hops.
Protocol round-trip tests cover absent-vs-present cache fields in `usage` parse. AC #2's live nonzero
`cache_read_input_tokens` is a post-deploy observation by design; CI proves the request/parse/aggregate/log chain.

## Risks / Trade-offs

- [Cache writes cost 1.25x; `send`'s first turn embeds the per-request goal, so single-shot authoring calls may pay
  the surcharge without a read] → Accepted: AC #1 explicitly requires `send` breakpoints; repair round-trips
  (`DashboardAuthoringService.runRepair`, `RefinementService`) re-send the marked prefix verbatim and do read it; the
  ticket's own telemetry addition is exactly what makes the realized hit rate verifiable post-deploy. Prefixes under
  the model's minimum cacheable length (1024–2048 tokens) are ignored server-side — no write, no surcharge.
- [`claudeApiMessageFormat` moving off `jsonFormat2` could change unmarked serialization] → Mitigated by an explicit
  unchanged-bytes test for the `None` case (D6). Note the `None` path is a test/default guarantee, not a production
  one on this route: every real `send`/`stream` call with non-empty messages is marked after D3.
- [D3's unconditional first-message marking breaks `ClaudeClientSpec`'s "wire model/max-tokens/temperature/messages
  through" exact-equality fixture (the suite's only full-request equality assertion, per grep) and contradicts the
  active `claude-api-client` requirement "Existing single-shot send and stream are unaffected" ("every existing test
  passes unmodified")] → The fixture update is an explicit task (4.6), and this change's spec delta carries a
  MODIFIED entry superseding that requirement's scenario, so the archived spec never promises what the code violates
  (skeptic-design-1.md CR1).
- [Anthropic could reject `cache_control` on an unexpected block position] → `tool_result` blocks are valid
  breakpoint carriers per the API; the D6 transport-shape tests pin placement, and any 4xx surfaces through the
  existing `ClaudeApiException` → `ClaudeError.ApiError` path, observable in logs.

## Planner Notes

- Self-approved: extending `stream`'s requests via the shared `toApiRequest` builder (harmless, consistent; D3).
- Self-approved: `TokenUsage` extension is safe for the wire — verified no formatter/HTTP exposure exists (Context).
- No migration plan needed: no persistence, schema, or config surface changes; rollback is a plain revert.
