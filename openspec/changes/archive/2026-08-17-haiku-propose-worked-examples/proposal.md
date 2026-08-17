## Why

Since `CLAUDE_MODEL` was pinned to Haiku 4.5 (cost fix), the assistant remains good at gathering
(`find`/`get_resource`) but weaker at shaping — emitting a final `propose_*` call that actually conforms to its
schema. Both guidance surfaces are rules-only today: `AssistantSystemPrompt.text` has hard rules but zero worked
examples, and `AssistantProposalToolSchemas` has per-field descriptions but zero `examples`. Rules-without-examples is
a known weak spot for smaller models on structured output. Additionally, nothing measures shaping quality: a malformed
call dies in `AssistantToolExecutor.decode` as an error `tool_result`, invisible to `AssistantTelemetry`. This ticket
tries the cheap fix (worked examples) and adds the instrument to know whether it worked — the Sonnet upgrade is an
explicit documented fallback decision, not an implementation.

## What Changes

- Add one fully-formed, decoder-verified worked example per `propose_*` tool as a top-level JSON-Schema `examples`
  array in each tool's `inputSchema` (non-normative, additive).
- Append a compact "Worked examples / shaping guidance" section to `AssistantSystemPrompt.text`, focused on the
  trickiest shaping spots (the `propose_combined` `"$pipelineOutput"` sentinel, `propose_patch_set` target/op/patch,
  source-branch exclusivity), with explicit "ids here are placeholders — use ids you actually received" annotations.
- Add per-turn propose-call quality counters to `AssistantToolExecutor` (attempts, decode failures, downstream
  validation failures), threaded through `AssistantTurnResult` into the existing `assistant_tool_loop_outcome`
  telemetry line — joined with the already-logged `modelId`, this is the by-model measurement signal.
- Unit tests pinning each schema example decodable by the same spray-json decoder real calls hit, plus counter and
  telemetry-field coverage.
- PR body documents the before/after comparison procedure and the explicit Sonnet-fallback decision point.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `assistant-conversation-loop`: every `propose_*` tool's guidance (input schema + system prompt) includes at least
  one concrete worked example, and each schema example must decode via the tool's real decoder.
- `assistant-tool-loop-telemetry`: the per-turn telemetry record additionally carries propose-call quality counters
  (attempts / schema-decode failures / validation failures) so shaping quality is measurable per model.

## Impact

- Backend only: `AssistantSystemPrompt.scala`, `AssistantProposalToolSchemas.scala`, `AssistantToolExecutor.scala`
  (propose_* paths only — `find`/`get_resource` behavior untouched), `AssistantService.scala`,
  `AssistantProtocol.scala` (`AssistantTurnResult` fields, backend-internal — no `schemas/` file describes it),
  `AssistantTelemetry.scala`, `AssistantConversationRoutes.scala` (telemetry call site), matching specs.
- No migration, no frontend change, no `schemas/*.json` change; prompt-token growth is mitigated by HEL-699's
  prompt caching (static prefix).

## Non-goals

- Switching `CLAUDE_MODEL` to Sonnet (globally or per-route) — documented fallback decision only, no code change.
- Any behavior change to `find`/`get_resource` or to proposal validation semantics.
- A statistically rigorous live-traffic A/B — the telemetry is the durable instrument; the PR documents an honest
  manual before/after procedure.
