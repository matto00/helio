# HEL-1636: Assistant breaks on claude-haiku-5-5: thinking blocks become empty text blocks, so the second message 400s

## Description

### Symptom (prod, 2026-10-16, owner-reported)

With prod's `CLAUDE_MODEL` switched to `claude-haiku-5-5` (a manual `gcloud run services update`; the deploy workflow still says `claude-haiku-4-5-20251001`):

1. First message "Hello": the assistant answers, but the conversation shows an **empty ASSISTANT bubble** before the real reply.
2. Second message ("Can you update my Standings dashboard with more charts please?"): it fails with
   `Claude API error (400): {"type":"error","error":{"type":"invalid_request_error","message":"messages: text content blocks must be non-empty"},"request_id":"req_011Cg6gUq3QfPdJ3kw42HdaU"}`

So every conversation fails on its second turn.

### Cause (driver's reading of the code; verify it, red first)

Claude Haiku 5.5 runs **adaptive thinking by default**: a response can start with `thinking` blocks. Their `thinking` text is empty by default (display `omitted`) and they carry a `signature`. Claude Haiku 4.5 never returned them unless asked.

* `backend/.../infrastructure/ai/ClaudeProtocol.scala` `claudeApiContentBlockFormat.read`: unknown block types fall to `case _ =>`, which keeps only `text`. A `thinking` block loses its `thinking` and `signature` fields.
* `backend/.../infrastructure/ai/ClaudeClient.scala:181-182` `toContentBlock`: `case _ => ClaudeContentBlock.Text(b.text.getOrElse(""))`, so the thinking block becomes `Text("")`.
* That empty text block is saved in the assistant turn (the empty bubble), sent back in `history` on the next `converse`, and serialized as `{"type":"text","text":""}`. The API rejects it with "text content blocks must be non-empty".
* **The same defect affects the tool loop** (`sendWithTools`, about lines 119-131): within one turn the assistant content is sent back on each hop, so a thinking block followed by `tool_use` breaks the second hop the same way. Even if it were passed through, it would lack the `signature` the API needs to accept a thinking block back.

### Other Haiku 5.5 API differences to check in the same change (from the Haiku 5.5 migration notes)

* **Sampling:** `temperature` must be `1`; any other value returns a 400, as do `top_k` and `temperature` plus `top_p` together. `ClaudeProtocol` always sends `temperature` from `CLAUDE_TEMPERATURE` (default 1.0, no caller overrides it today). Guard this or omit the field for this model.
* **Thinking counts toward** `max_tokens`: the `CLAUDE_MAX_TOKENS` clamp (4096) is shared with thinking. Check that a long answer still fits, or set `output_config.effort`.
* **Assistant prefill returns a 400:** confirm no request ends with an assistant turn.
* **web_search:** `web_search_20250305` is correct for Haiku (the `_20260209` variant isn't offered for it).
* **Refusals:** new `stop_reason: "refusal"` with `stop_details`, with no server-side fallback for Haiku. It must surface as a clear error, never an empty answer.
* **Forced** `tool_choice`: still accepted, but skips thinking.

### Fix direction (design decision for the lane)

Model `thinking` (and `redacted_thinking`) as their own content-block type that keeps `thinking` and `signature` exactly, sends them back **unchanged** within the tool loop, and never renders them as an assistant bubble. Never turn an unknown block into an empty `Text`: preserve it or drop it explicitly, and never write an empty text block to the wire. Decide deliberately whether saved conversation history keeps thinking blocks across turns (allowed) or drops them (also allowed between turns, but not mid tool loop).

An alternative stopgap is to send `thinking: {"type": "disabled"}`, which Haiku 5.5 accepts at effort high or lower. But the generic `case _ => Text("")` trap must be fixed either way; it turns any new block type into a broken history.

## Acceptance criteria

- [ ] A seam test with a real Haiku-5.5-shaped response (a thinking block with empty `thinking` and a `signature`, then `text`) fails on the current code and passes after: no empty assistant turn is saved, and the next turn's request has no empty text block.
- [ ] A tool-loop test (thinking, `tool_use`, then a second hop) sends the thinking block back unchanged, with its signature.
- [ ] No content-block type the client doesn't know about is ever turned into an empty `Text` or written as an empty text block (guard test).
- [ ] The sampling and refusal handling above is checked for this model.
- [ ] Prod model switch: `CLAUDE_MODEL=claude-haiku-5-5` in **both** `.github/workflows/cd-backend.yml` (line 91) and `infra/deploy-backend.sh` (line 110). Every release deploy re-applies the workflow value.
- [ ] Live check against the real API (an isolated environment, or prod after release): a 2-message conversation and a web-search/tool conversation both succeed on `claude-haiku-5-5`.

## Rollback until fixed

`gcloud run services update helio-backend --region us-west1 --project helio-493120 --update-env-vars CLAUDE_MODEL=claude-haiku-4-5-20251001`
