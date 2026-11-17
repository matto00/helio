# Anthropic API contract notes (fetched 2026-11-16 from platform.claude.com, official docs only)

Source pages:
- https://platform.claude.com/docs/en/build-with-claude/thinking
- https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows
- https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
- https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- https://platform.claude.com/docs/en/api/errors
- https://platform.claude.com/docs/en/api/overview
- https://platform.claude.com/docs/en/about-claude/pricing
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool

## Content blocks
- Thinking: `{"type":"thinking","thinking":"...","signature":"..."}`. "The `signature` field is opaque: don't interpret
  or parse it."
- Omitted display (the Haiku 5.5 default): `{"type":"thinking","thinking":"","signature":"EosnCk..."}`. "A block whose
  `thinking` field is empty is still complete: the `signature` holds the reasoning. Send it back with the turn like any
  other."
- Redacted: `{"type":"redacted_thinking","data":"..."}`. "Filtering on `block.type == "thinking"` alone silently drops
  `redacted_thinking` blocks and breaks the multi-turn protocol."
- Haiku 5.5 runs adaptive thinking by default: "a response can start with one or more `thinking` blocks even when the
  request doesn't set `thinking`."

## Round-trip rules
- "**Required:** within a tool-use turn, pass thinking blocks back. **Recommended:** across turns, pass everything
  back. **Allowed:** outside tool use, omit prior turns' thinking, but not a block between two that you keep."
- Errors page: "`thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These
  blocks must remain as they were in the original response."
- Haiku 5.5 keeps prior-turn thinking. Conversations must be append-only. A failed prefix check returns 400 "Invalid
  `signature` in `thinking` block. The block is bound to a different conversation...".

## Prefix checks (skeptic-design-1 CR1)
Source: https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks
- "A prefix check fails if system, tools, or an earlier message changed after Claude produced a block."
- "Adds, removes, or rewords a tool ... Stop changing tools."
- "Only system, tools, and messages are compared"; the comparison is on parsed JSON.
- On Haiku 5.5 the result is "Possible 400 error".
- Leaving blocks out is allowed: "you can leave out the oldest, the newest, or all of them, but not one in between".

## Haiku 5.5 request constraints
- Sampling: "Remove `temperature`, `top_p`, and `top_k` from your requests." Non-default values return 400. From API
  version `2026-10-21`, any value returns 400. Helio sends `anthropic-version: 2023-06-01`.
- "Thinking tokens count toward `max_tokens`, so a request with a small `max_tokens` can stop with
  `stop_reason: "max_tokens"` after a `thinking` block and before any text."
- Prefill is rejected: "This model does not support assistant message prefill. The conversation must end with a user
  message."
- `web_search_20250305` supports `claude-haiku-5-5`.
- Forced `tool_choice` is accepted, but the response has no thinking block.

## Refusal shape
`{"stop_reason":"refusal","content":[],"stop_details":{"type":"refusal","category":"cyber","explanation":"..."},
"usage":{"output_tokens":0}}`

- `category` and `explanation` can be null.
- `stop_details` is null for every other stop reason.
- "Branch on `stop_reason` or `stop_details.type`, not on `content`."

## Empty end_turn (skeptic-design-2 CR1)
Source: https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
- "Sometimes Claude returns an empty response (exactly 2-3 tokens with no content) with `stop_reason: "end_turn"`.
  This typically occurs when Claude determines that the assistant turn is complete, particularly after tool results."

## Empty text blocks
- No documented rule says an empty text block is rejected. The prod 400 ("messages: text content blocks must be
  non-empty", req_011Cg6gUq3QfPdJ3kw42HdaU) is the evidence for it.

## Streaming
- `thinking_delta` (field `thinking`) and `signature_delta` (field `signature`) arrive inside `content_block_delta`.
  `ClaudeSseFrameParser` reads only `delta.text`, so it drops both.

## Pricing (Haiku 5.5, prompt at or under 100k tokens)
- Per MTok: input $0.10, 5m cache write $0.125, cache read $0.01, output $0.50.
- Web search: $10 per 1,000 searches.

## Response header
- `request-id` (lowercase, prefix `req_`).
