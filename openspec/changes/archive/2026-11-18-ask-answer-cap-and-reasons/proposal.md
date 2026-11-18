## Why

HEL-1745's final skeptic left three gaps in the ask-your-data backend. On Claude 5.5 models adaptive thinking is on by default
and spends from the same `max_tokens` as the answer, so the 1024-token answer cap can end a hop with only a thinking block,
which surfaces today as a generic `502`. The `422 ASK_UNGROUNDED` body echoes the uncited numerals and dates of the rejected
answer. The pin's `rootId` fallback for pre-V98 Outputs has no test that can tell it from the normal path.

## What Changes

- Raise the ask hop cap from 1024 to 4096 tokens (still clamped by `CLAUDE_MAX_TOKENS`).
- A hop that stops at `max_tokens` (thinking-only OR partial text) ends the ask with `422` code `ASK_ANSWER_TRUNCATED`
  and no answer text, instead of `502` or a truncated answer. No retry. One WARN line per occurrence so frequency can be
  counted from logs once real traffic exists.
- The `422 ASK_UNGROUNDED` body's `reasons` become value-free categories (no digits, no quoted values). The corrective
  turn sent to the model still gets the full reasons.
- Tests: the max_tokens stops, digit-free reasons, and the pin `rootId` fallback, each recorded red first.
- CLAUDE.md's ask endpoint line documents the new `422` code.

## Capabilities

### New Capabilities

### Modified Capabilities
- `ask-your-data`: "Cited, validated answers" gains the truncation outcome and value-free reasons; "Pin hand-off without render" states the pre-V98 root fallback.

## Impact

- `backend/src/main/scala/com/helio/services/ask/AskDataService.scala`, `api/routes/ask/AskRoutes.scala`,
  `api/protocols/ask/AskProtocol.scala` (if a response type is added), `infrastructure/ai/ClaudeModels.scala` +
  `ClaudeClient.scala` (FinalResponse carries the hop's `stop_reason` in its second parameter list; no extractor change).
- Tests in `backend/src/test/scala/com/helio/services/ask/` and `api/routes/ask/AskRoutesSpec.scala`.
- No migration, no frontend, no schema file change (`schemas/ask/` holds only the request and 200 response).
- Worst-case output spend per ask rises (4096 vs 1024 per hop); output is billed as used.
