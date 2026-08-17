# Tasks: idempotent-chat-send-retry (HEL-698)

## 1. Backend

- [x] 1.1 Add migration `V87__assistant_conversation_idempotency_key.sql`: `ALTER TABLE assistant_conversations ADD COLUMN last_idempotency_key TEXT NULL`
- [x] 1.2 Thread the column through `AssistantConversationRepository`: `AssistantConversationRow`/`AssistantConversationTable`/`AssistantConversationRecord` gain `lastIdempotencyKey: Option[String]`; `rowToRecord`/`recordToRow` updated; `create` sets `None`
- [x] 1.3 `touchUpdatedAt` gains `lastIdempotencyKey: Option[String]`: when `Some`, written in the SAME update tuple as `gcs_body_ref`/`updated_at`; when `None`, the column is left UNTOUCHED (design.md D2/D3 — never null it out)
- [x] 1.4 `AssistantConversationService.appendTurn` gains `idempotencyKey: Option[String]` (default `None`): after `findById`, when the key is defined and equals `record.lastIdempotencyKey`, skip blob write + touch and return the record; otherwise pass the key to `touchUpdatedAt` (design.md D3 append-time check)
- [x] 1.5 `ConverseRequest` gains `idempotencyKey: Option[String]` (`jsonFormat2`); normalize in the route: trim, blank → absent, >128 chars → 400 (design.md D5)
- [x] 1.6 `AssistantConversationResponse` gains `lastIdempotencyKey: Option[String]` (`jsonFormat8`); `detailOf` populates it from `detail.record.lastIdempotencyKey` (both GET and converse paths)
- [x] 1.7 `converseFlow`: route-entry replay check — key defined and equal to `existing.record.lastIdempotencyKey` → `Right(detailOf(existing))`, no Claude call, no telemetry, one info log line (design.md D3/D4); otherwise thread the key into `appendTurn`
- [x] 1.8 Confirm the `/messages` append route compiles passing no key (default `None`) with behavior unchanged

## 2. Schemas

- [x] 2.1 `schemas/converse-request.schema.json`: add optional `idempotencyKey` (string, maxLength 128) with description
- [x] 2.2 `schemas/assistant-conversation.schema.json`: add optional `lastIdempotencyKey` (string) with description (persisted fact, present on GET too — unlike the HEL-667 ephemeral signals)

## 3. Frontend

- [x] 3.1 `types.ts`: `AssistantConversationDetail` gains optional `lastIdempotencyKey?: string`
- [x] 3.2 `assistantConversationsService.ts`: `converse(id, message, idempotencyKey)` sends `{ message, idempotencyKey }`
- [x] 3.3 `assistantConversationsSlice.ts`: `converse` thunk arg gains `idempotencyKey`; on rejection, reconcile via `getConversation(id)` — `lastIdempotencyKey === idempotencyKey` → return fetched detail (fulfilled); otherwise/on fetch failure → `rejectWithValue(original error)` (design.md D6)
- [x] 3.4 `MessageComposer.tsx`: `pendingSend {key, text}` local state — reuse key iff preserved text matches, else `crypto.randomUUID()`; pass key into the thunk; clear `pendingSend` on success (design.md D6)

## 4. Tests

- [x] 4.1 `AssistantConversationRepositorySpec`: `touchUpdatedAt` persists a `Some` key; a `None` key leaves a previously-set value untouched
- [x] 4.2 `AssistantConversationServiceSpec`: keyed append records the key; matching-key append no-ops (transcript unchanged, record returned); keyless append leaves a previously-set key in place
- [x] 4.3 `AssistantConversationRoutesSpec`: same-key converse twice → second 200, transcript unchanged, stub `AssistantService.converse` invoked exactly once; >128-char key → 400, nothing persisted; keyless converse behaves exactly as before; GET and converse responses carry `lastIdempotencyKey`
- [x] 4.4 `assistantConversationsSlice.test.ts`: rejection + matching-key reconciliation → fulfilled with fetched detail; non-matching key → rejected with original message; reconciliation fetch failure → rejected
- [x] 4.5 New `MessageComposer.test.tsx`: same-text retry reuses the key; edited text gets a fresh key; success clears `pendingSend`; reconciled-as-landed send clears input and shows no error banner
- [x] 4.6 Run full gates: backend `sbt test`, frontend `npm test`, `npm run lint`, `npm run format:check`
