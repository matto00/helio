# Design — haiku-propose-worked-examples (HEL-700)

## Context

`AssistantService.converse` runs a 6-tool loop; a `propose_*` call's input is decoded in
`AssistantToolExecutor.decode` (`input.convertTo[T]`; `DeserializationException` → `Left` → error `tool_result` fed
back to Claude) and then semantically validated by the proposal services. Both failure layers are invisible to
`AssistantTelemetry.emitToolLoopOutcome` today. Guidance is rules-only: `AssistantSystemPrompt.text` (folded into the
first user turn — no separate system channel; HEL-699 caches this static prefix) and hand-rolled `JsObject` input
schemas in `AssistantProposalToolSchemas` (`ClaudeTool.inputSchema: JsValue`, passed verbatim to the API).

## Goals / Non-Goals

- Goals: worked examples on both guidance surfaces; a by-model measurement signal for propose-call shaping quality;
  examples that cannot silently rot (decoder-pinned); explicit documented Sonnet-fallback decision in the PR.
- Non-goals: model swap in code; any `find`/`get_resource` behavior change; validation-semantics changes; frontend
  changes; a live-traffic A/B harness.

## Decisions

### D1 — Examples on both surfaces, division of labor
Schema layer: one fully-formed input object per tool in a top-level `"examples"` JSON-Schema array (non-normative,
additive — the drift check maps `schemas/*.json` titles to protocol case classes and never inspects these hand-rolled
schemas). Prompt layer: a compact "Worked examples" section in `AssistantSystemPrompt.text` covering only the known
shaping traps — the `propose_combined` `"$pipelineOutput"` sentinel, `propose_patch_set` `target`/`op`/`patch` shape
(id required for update/delete), and pipeline `source` existing-vs-inline branch exclusivity. Rationale: the schema
example is closest to the function-calling contract (what the model reads when forming the call); the prompt section
teaches cross-field/cross-tool rules a per-tool schema can't. Alternative (prompt-only) rejected: schema-adjacent
examples are the standard lever for structured-output quality on smaller models.

### D2 — Author examples as compact JSON string literals, pinned by decode tests
Examples are `"""..."""`.parseJson` literals at object init, not hand-rolled `JsObject` trees (a full dashboard
example as nested `JsObject` would be unreadable and error-prone). Every schema example gets a unit test asserting it
decodes via the SAME decoder path real calls hit (`convertTo[DashboardProposal|PipelineProposal|CombinedProposal|
PatchSet]`) — the example cannot drift from the protocol without a red test. `propose_combined`'s example must use the
literal `"$pipelineOutput"` sentinel and still decode.

### D3 — Placeholder ids must not teach fabrication
Every example id uses an obviously-synthetic value (e.g. `"dt_example_from_find"`) and the prompt section states
explicitly: ids in examples are placeholders — a real call must only use ids returned by `find`/`get_resource`
(reinforcing the existing hard rule, never contradicting it). The `propose_dashboard` prompt example is framed as the
tail of a mini-transcript (after find/get_resource returned the id), not as a free-standing invention.

### D4 — Counters live in `AssistantToolExecutor`, propose_* paths only
Three per-turn counters — `proposeAttempts`, `proposeDecodeFailures` (decode `Left`, the shaping signal),
`proposeValidationFailures` (validate/preview `Left`) — as `AtomicInteger`s, for the same reason `capturedProposal`
is an `AtomicReference`: `sendWithTools` executes same-hop `tool_use` blocks concurrently via `Future.traverse`.
`executeFind`/`executeGetResource` are untouched. Alternative (parse Claude-visible error `tool_result`s post-hoc
from `fullHistory`) rejected: string-matching error text is fragile; counting at the failure site is exact.

### D5 — Threading: flat fields on `AssistantTurnResult`; routes emit
`AssistantTurnResult` gains three flat `Int` fields (precedent: `toolCallCount`/`hopBudgetExhausted` already ride it
purely for routes/telemetry). It is backend-internal — `converseFlow` returns `AssistantConversationResponse` built
by `detailOfConverse`, never a serialized `AssistantTurnResult`, and no `schemas/*.json` describes it — so no wire or
drift impact. `converseFlow` passes the counters into `emitToolLoopOutcome`, which gains three fields on the
`assistant_tool_loop_outcome` line; joined with the already-logged `modelId`, Cloud Logging can segment failure rates
by model. Alternative (new stats side-channel changing `converse`'s return shape) rejected: pointless ripple.

### D6 — Measurement story and the fallback decision
The telemetry line is the durable instrument (per-model propose decode-failure rate over real usage). Because the
"before" build has no such counters, the PR documents an honest manual before/after protocol: a fixed set of ~5
representative goals (at least one per propose_* tool) run locally with `CLAUDE_MODEL=claude-haiku-4-5-20251001`
on main vs. this branch, malformed-call counts read from transcript inspection (before) and the new log line (after).
The PR body must contain an explicit "Sonnet fallback considered" section stating why it was or wasn't taken, per the
ticket's AC — guidance text, not a code change. Scoped-per-route model override is named there as future work only.

### D7 — Privacy: count failures, never log the failing payload
The malformed `tool_use.input` embeds user-goal-derived text; `AssistantTelemetry`'s "never logs the user's typed
message" discipline extends to it. Only integer counters reach the log line — no payload, no error-message text.

## Risks / Trade-offs

- [Examples rot as protocols evolve] → decode-pin unit tests fail the build on any divergence (D2).
- [Prompt/schema token growth on every call] → keep additions compact (~1 example per tool, terse prompt section);
  HEL-699's prompt caching makes the enlarged static prefix a one-time cache write per TTL window.
- [Examples teach id fabrication] → D3 annotations + mini-transcript framing.
- [Examples accidentally semantically invalid (e.g. unbindable panel kind)] → keep examples minimal and conservative
  (chart/table panels with ordinary fieldMapping; executor cross-checks against `panelCapabilities` conventions).
- [New telemetry fields mistaken for wire contract] → D5 grounding: `AssistantTurnResult` never serializes; evaluator
  should re-verify `check-schema-drift.mjs` passes.

## Migration Plan

Pure additive backend change; deploy with no flags. Rollback = revert. No data model impact.

## Open Questions

(none — self-approved decisions below)

## Planner Notes

- Self-approved: extending `AssistantTurnResult` + `emitToolLoopOutcome` signatures (internal, precedent-consistent).
- Self-approved: examples as parsed string literals (D2) despite the file's hand-rolled-JsObject house style — the
  style exists for schemas, not fixtures; decode tests keep the literals honest.
- The `assistant-tool-loop-telemetry` spec's existing requirement is untouched; new counter behavior lands as an
  ADDED requirement (both spec deltas are ADDED, not MODIFIED).
