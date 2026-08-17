# HEL-699: Enable Anthropic prompt caching for the assistant's tool-use loop

## Description

Confirmed via `backend/src/main/scala/com/helio/ai/ClaudeWireModels.scala` and `HttpClaudeTransport.scala`: there is currently zero `cache_control` support anywhere in the Claude API wire layer. `ClaudeApiToolRequest`'s `tools: Seq[ClaudeApiTool]` and `messages: Seq[ClaudeApiToolMessage]` have no cache-breakpoint field at all.

The assistant's tool-use loop (`AssistantService`, up to 3 hops per conversation turn per `AssistantSystemPrompt`'s hard rules) re-sends the ENTIRE accumulated history, the full `tools` array, and the system-prompt text (folded into the first `user` turn — `ClaudeRequest`/`ClaudeToolRequest` has no separate `system` field, see `AssistantSystemPrompt.scala`'s own doc comment) on every single hop. That's a large, byte-stable, fully-repeated prefix on hop 2 and hop 3 of any multi-hop turn — a clean prompt-caching win with zero behavior change.

## Scope

- Add a cache-control field to the wire content-block/tool models (`ClaudeApiContentBlock`, `ClaudeApiTool`), wired through the JSON writer as `"cache_control": {"type": "ephemeral"}`.
- Mark the last block of the stable prefix (end of the `tools` array, and the system-prompt-carrying first turn) as a cache breakpoint for both `send` and `sendTool`.
- Surface `cache_read_input_tokens`/`cache_creation_input_tokens` from the Anthropic API's usage response (already have a `ClaudeApiUsage` wire model) into logs/telemetry so the cache-hit rate and actual cost savings are verifiable post-deploy, not just assumed.

## Acceptance criteria

- [ ] Outgoing `/v1/messages` requests include `cache_control` breakpoints on the stable prefix for both `send` and `sendTool`.
- [ ] A multi-hop tool-use turn (2nd/3rd hop within one `/converse` call) shows a nonzero `cache_read_input_tokens` in the logged usage for the repeated prefix.
- [ ] No change to conversation behavior/output — this is purely a cost optimization.

## Metadata

- Priority: Medium
- Project: Helio v1.6 — Agentic Workflows & Pipelines
- Ticket URL: https://linear.app/helioapp/issue/HEL-699/enable-anthropic-prompt-caching-for-the-assistants-tool-use-loop
- Branch: feature/anthropic-prompt-caching/HEL-699
- Note: Pure backend wire-protocol change — no schema/frontend/database impact, no migration. Zero file overlap with concurrently-running HEL-703 (AuthService/OAuthRoutes/UserRepository, migration V88).
