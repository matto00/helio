# Files Modified — idempotent-chat-send-retry (HEL-698)

## Backend

- `backend/src/main/resources/db/migration/V87__assistant_conversation_idempotency_key.sql` — new migration: `ALTER TABLE assistant_conversations ADD COLUMN last_idempotency_key TEXT NULL`
- `backend/src/main/scala/com/helio/infrastructure/AssistantConversationRepository.scala` — `AssistantConversationRecord`/`AssistantConversationRow`/`AssistantConversationTable` gain `lastIdempotencyKey: Option[String]`; `rowToRecord`/`recordToRow` updated; `touchUpdatedAt` gains a `lastIdempotencyKey` param (`Some` writes it in the same update tuple as `gcs_body_ref`/`updated_at`, `None` — the default — leaves the column untouched)
- `backend/src/main/scala/com/helio/services/AssistantConversationService.scala` — `appendTurn` gains an `idempotencyKey: Option[String] = None` param; a defined key matching the existing record's `lastIdempotencyKey` short-circuits to a no-op replay (skips blob write + touch, returns the existing record)
- `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala` — `ConverseRequest` gains `idempotencyKey: Option[String]` (`jsonFormat1` → `jsonFormat2`); `AssistantConversationResponse` gains `lastIdempotencyKey: Option[String]` (`jsonFormat7` → `jsonFormat8`)
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala` — `detailOf` populates `lastIdempotencyKey`; `converseFlow` gains a route-entry replay check (key matches the existing record's `lastIdempotencyKey` → return current detail, no Claude call, no telemetry, one info log line) and threads the key into `appendTurn`; the `/converse` route normalizes the incoming key via `RequestValidation.validateIdempotencyKey`, returning `400` on an over-long key
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — new `validateIdempotencyKey`/`MaxIdempotencyKeyLength` (trim, blank → absent, >128 chars → `Left`)

## Backend tests

- `backend/src/test/scala/com/helio/infrastructure/AssistantConversationRepositorySpec.scala` — `touchUpdatedAt` with a `Some` key persists it; with a `None` key leaves a previously-set key untouched; `create`'s round-trip asserts `lastIdempotencyKey` defaults to `None`
- `backend/src/test/scala/com/helio/services/AssistantConversationServiceSpec.scala` — keyed append records the key; matching-key append no-ops (transcript unchanged, existing record returned); keyless append leaves a previously-set key in place
- `backend/src/test/scala/com/helio/api/routes/AssistantConversationRoutesSpec.scala` — same-key converse twice → second is a 200 no-op replay, transcript unchanged, underlying Claude transport invoked exactly once; an over-128-char key → `400`, nothing persisted; a keyless converse omits `lastIdempotencyKey` from the response entirely; GET and converse responses both carry `lastIdempotencyKey` once a keyed send has landed

## Schemas

- `schemas/converse-request.schema.json` — optional `idempotencyKey` (string, `maxLength: 128`)
- `schemas/assistant-conversation.schema.json` — optional `lastIdempotencyKey` (string)

## Frontend

- `frontend/src/features/assistant/types.ts` — `AssistantConversationDetail` gains optional `lastIdempotencyKey?: string`
- `frontend/src/features/assistant/services/assistantConversationsService.ts` — `converse(id, message, idempotencyKey?)` sends `{ message, idempotencyKey }`
- `frontend/src/features/assistant/state/assistantConversationsSlice.ts` — `converse` thunk arg gains `idempotencyKey?: string`; on rejection with a defined key, reconciles via `getConversation(id)` — a matching `lastIdempotencyKey` fulfills with the fetched detail, otherwise (or on a failed reconciliation fetch) rejects with the original error message
- `frontend/src/features/assistant/ui/MessageComposer.tsx` — new `pendingSend: {key, text} | null` local state; reuses the key on a same-text retry, mints a fresh `crypto.randomUUID()` otherwise; passes the key into the `converse` thunk; clears `pendingSend` only on success

## Frontend tests

- `frontend/src/features/assistant/services/assistantConversationsService.test.ts` — keyless converse omits `idempotencyKey` from the body (`undefined`); a supplied key rides along in the body
- `frontend/src/features/assistant/state/assistantConversationsSlice.test.ts` — `converse` thunk passes `idempotencyKey` through; rejection reconciliation: matching key → fulfilled with the fetched detail, non-matching key → rejected with the original message, failed reconciliation fetch → rejected with the original message
- `frontend/src/features/assistant/ui/ActiveConversationPanel.test.tsx` — two pre-existing `converseMock` assertions updated to accept the now-always-present 3rd `idempotencyKey` argument (`expect.any(String)`)
- `frontend/src/features/assistant/ui/MessageComposer.test.tsx` — new file: same-text retry reuses the key; edited text mints a fresh key; a successful send clears `pendingSend` (a later identical-text send mints a fresh key, not the succeeded send's); a matching-key reconciliation clears the input and shows no error banner; a non-matching-key reconciliation keeps the failure UX (error shown, input preserved)

## Root cause / probe (systematic-debugging.md — not applicable, no bug being fixed here)

This ticket implements a new idempotency mechanism per an already-approved design (`design.md`
D1-D6), not a regression fix against a probe-confirmed root cause. The "root cause" the ticket
addresses is architectural (documented in `ticket.md`): `converseFlow` durably persists a turn via
`appendTurn` before its own final re-fetch, so any failure after that point (a transient read
failure, a Cloud Run restart, a client timeout) surfaces as total failure to the client even though
the turn landed. The fix (idempotency key + client reconciliation) is verified by the new tests
above, all passing.
