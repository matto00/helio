## Why

On `claude-haiku-5-5` (adaptive thinking on by default) every assistant conversation fails on its second message with
`400 text content blocks must be non-empty`. The client turns any content block it does not model, including a
`thinking` block, into an empty `Text`. That block is shown as an empty bubble, persisted, and sent back.

## What Changes

- Model `thinking` (`thinking` + `signature`) and `redacted_thinking` (`data`) as their own content blocks, kept byte-exact.
- Any other unknown block type is kept as opaque raw JSON. It is never turned into `Text`.
- Within one `sendWithTools` call, thinking, redacted and unknown blocks go back to the API unchanged on every hop.
- The assistant's persisted transcript drops thinking, redacted and unknown blocks, so prior turns never carry them.
- The client never writes an empty text block. This also repairs transcripts already saved with `Text("")`.
- A `refusal`, or a final response with no visible text (e.g. `max_tokens` spent on thinking), becomes a typed
  `ClaudeError.NoAnswer` on both the tool loop and single-shot `send`. The assistant route shows a clear error and
  persists nothing. A pipeline AI step fails instead of writing `""`.
- When the tool list changes between hops (the `web_search` budget shrinking), every earlier thinking block is
  dropped from that request, so a stale signature is never sent.
- `temperature` is omitted from the wire when it is the API default (1.0). Haiku 5.5's guide says to omit it.
- The frontend never renders an empty text block as a bubble (covers transcripts saved before this fix).
- Prod model pin moves to `claude-haiku-5-5` in `cd-backend.yml` and `deploy-backend.sh` (owner ruling, 2026-11-16).
- `HttpClaudeTransport` logs each response's `request-id` header (no body, no key) so a live run is traceable.
- One isolated live two-turn check on `claude-haiku-5-5` (owner-approved, hard cap $2), recorded as evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `claude-api-client`: content-block fidelity, empty-text invariant, `NoAnswer` error, default-temperature omission.
- `assistant-conversation-loop`: the persisted history excludes model-internal blocks; a no-answer turn is an error.

## Impact

Backend `infrastructure/ai` (`ClaudeProtocol`, `ClaudeWireModels`, `ClaudeModels`, `ClaudeClient`),
`AssistantService`, `AssistantConversationRepository` format, `ClaudeError` match sites (`AssistantConversationRoutes`,
`DashboardAuthoringService`, `RefinementService`, `ClaudeAiStepClient`), `HttpClaudeTransport`, `ActiveConversationPanel.tsx`,
`.github/workflows/cd-backend.yml`, `infra/deploy-backend.sh`, `CLAUDE.md` env table. No migration,
no schema or API contract change.

## Non-goals

- Any prod action (deploy, gcloud). The pin change ships with the next release.
- Red-first proof from live calls: proof uses recorded fixture responses; the live check is confirmation only.
- Showing thinking to users, `output_config.effort`, raising `CLAUDE_MAX_TOKENS`, or new `stream` event types.
- Re-injecting the system prompt on turns 2+ (a separate pre-existing defect, follow-up).
