## Why

HEL-921 needs insight Outputs whose text is grounded only in snapshot data and whose numbers are checkably cited.
The pure parts (what the model sees, how it is asked, what is accepted back) must exist and be proven before any
render trigger (L4) or ask route (L6) can spend real model budget.

## What Changes

- A bounded, citation-bearing grounding pack built from a node snapshot head, resolved compare deltas and window
  summary points, kept under an ~8k input-token budget and carrying no source/connection fields.
- Preset inference (delta / trend / leaders / summary) from what the node's Outputs carry, so no prompt is required.
- A model seam (`InsightModelClient`) with a fake for tests and a production adapter over the shared Claude client
  that sends a system prompt, no tools, no web search, max 400 output tokens. Not wired into any route or trigger.
- A validator that rejects over-length output, unknown citation markers and numerals not matching a cited value.
- A renderer that returns an accepted render, or a rejection that keeps the last good render (one retry, D9).
- Cost in micro-dollars from API usage times a per-model price table read from Anthropic's pricing page; recorded
  only, never enforced.

## Capabilities

### New Capabilities

- `insight-grounding`: grounding pack, preset inference, model seam, citation validator, render outcome and cost.

### Modified Capabilities

(none)

## Non-goals

- The `insight` Output kind (L1), render storage/read API (L2), triggers/quota (L4), UI (L5), ask (L6-L8).
- Any live model call, route, Flyway migration, or change to `ClaudeClient`/`ClaudeRequest`.
- Enforcing a dollar cap.

## Impact

New backend files only: `domain/insights/*`, `services/insights/*`, `infrastructure/ai/ClaudeInsightClient.scala`,
plus unit specs. No API, schema, DB or frontend change.
