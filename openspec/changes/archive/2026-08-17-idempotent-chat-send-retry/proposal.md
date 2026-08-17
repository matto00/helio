# Proposal: idempotent-chat-send-retry (HEL-698)

## Why

`AssistantConversationRoutes.converseFlow` durably persists the user's message and Claude's reply
(`appendTurn`) *before* the final `service.get` re-fetch that shapes the HTTP response. If that
re-fetch, or the response's trip back to the client, fails, the client reports total failure even
though everything landed — and a natural retry appends a near-duplicate user turn. This is a
structural gap in any side-effecting request over an unreliable network; HEL-696 made it rarer,
not impossible.

## What Changes

- `ConverseRequest` gains an optional client-generated `idempotencyKey`; the conversation row
  gains a `last_idempotency_key` column (migration V87) recording the key of the most recent
  *keyed* append (a keyless append leaves it untouched). A converse whose key matches the
  last-applied one is a no-op replay: no Claude call, no append — it returns the current
  conversation detail. The check runs at route entry and again at append time, closing the
  timeout-retry race where the original request is still in flight.
- `AssistantConversationResponse` gains an optional `lastIdempotencyKey`, present on `GET /:id`
  and converse responses, so the client can reconcile exactly (no text-matching heuristics).
- `MessageComposer` keeps one key per logical message (reused on retry of the same text, fresh on
  edit); the `converse` thunk, on rejection, re-fetches the conversation and — if the key matches —
  treats the send as succeeded (transcript updated, input cleared, no error banner).
- Schemas `converse-request` and `assistant-conversation` updated; all wire changes optional and
  backward-compatible (keyless callers behave exactly as today).

## Capabilities

### New Capabilities

- `assistant-send-reliability`: client-side send-key lifecycle and post-error reconciliation —
  the displayed state after an error reflects whether the message actually landed.

### Modified Capabilities

- `assistant-live-converse`: converse dedupes replays via the idempotency key and exposes
  `lastIdempotencyKey` on the response.

## Impact

- Backend: `AssistantConversationRoutes`, `AssistantConversationService`,
  `AssistantConversationRepository` (+record/table), `AssistantConversationProtocol`, V87 migration.
- Frontend: `MessageComposer`, `assistantConversationsSlice`, `assistantConversationsService`, types.
- Schemas: `converse-request.schema.json`, `assistant-conversation.schema.json`.

## Non-goals

- Idempotent conversation *creation*: the composer's null-conversation path already converges on the
  created id via `setSelectedConversationId`; a lost create response can at worst leave one empty
  "New conversation" shell — no AC covers it.
- Streaming/SSE for converse; removing the route's deliberate final re-fetch; a multi-key
  idempotency table with TTL (the composer serializes sends, so last-key-only suffices).
