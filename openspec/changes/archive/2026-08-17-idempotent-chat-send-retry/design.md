# Design: idempotent-chat-send-retry (HEL-698)

## Context

`converseFlow` (`AssistantConversationRoutes.scala:114-146`) runs get → `assistantService.converse`
(up to 3 tool-call hops, seconds long) → `service.appendTurn` (ONE atomic blob write persisting the
user turn AND Claude's reply together, then `repo.touchUpdatedAt`) → final `service.get` to shape
the response. Any failure after the append — the re-fetch, a Cloud Run restart, a client timeout —
surfaces as total failure client-side. `MessageComposer` preserves the input and the user retries,
producing a duplicate user turn.

## D1 — Two mechanisms, one per acceptance criterion

- **Server idempotency key → AC1** (no duplicate turn on retry). Client-generated key on
  `ConverseRequest`; the last-applied key is persisted on the conversation row; a converse whose key
  matches is a replay: return current detail, never call Claude, never append.
- **Client reconciliation → AC2** (displayed state reflects reality). On converse rejection, the
  thunk re-fetches `GET /:id`; `lastIdempotencyKey === sentKey` proves the send landed — and because
  `appendTurn`'s blob write is atomic, Claude's reply landed with it — so the client treats the send
  as succeeded wholesale. No text-matching heuristics.

Either alone fails an AC: key-only still shows a false "failed" banner; reconciliation-only cannot
protect a retry racing an original request that is still mid-Claude-call ("not landed yet" is not
"will never land").

## D2 — Key storage: nullable column, not blob or key-table

`last_idempotency_key TEXT NULL` on `assistant_conversations` (V87 — verified current max is V86 on
main; report any collision). The blob format (`claudeToolMessageFormat`, repository-internal) stays
untouched — no back-compat risk for existing transcripts, and the route-entry replay check needs the
key without a blob read. Last-key-only suffices: the composer serializes sends (`sending` guard), a
new logical message gets a fresh key, so only the most recent send is ever retried. Semantics
(skeptic design-gate round-1 change #2): the column holds the key of the most recent KEYED append —
a `None`-keyed append (the `/messages` route, today with zero real callers, or a keyless converse)
leaves it UNTOUCHED. Nulling it there would let an unrelated keyless append silently un-protect an
outstanding keyed retry; leaving the last real key in place is strictly safer, costs nothing, and
cannot false-positive (keys are per-logical-message UUIDs — a fresh send never reuses an old one).

## D3 — Double-check placement closes the timeout-retry race

1. **Route entry** (`converseFlow`, right after the initial `service.get`): key defined and equals
   `existing.record.lastIdempotencyKey` → `Right(detailOf(existing))` immediately. Cheap replay path.
2. **Append time** (`appendTurn`, on its freshly-read `findById` record): key defined and equals
   `record.lastIdempotencyKey` → skip blob write and touch, return the record — a concurrent
   duplicate already applied this send.

Race walkthrough: client times out, original still on a Claude hop, user retries with the same key.
Both eventually reach `appendTurn`; whichever lands second sees the key already recorded and no-ops.
Residual window: the milliseconds between one request's blob read and write vs. the other's — against
multi-second Claude calls, and a composer that never has two sends in flight, accepted (Planner
Notes). `touchUpdatedAt` gains the key param, written in the SAME update as
`gcs_body_ref`/`updated_at` when the key is `Some` — key and metadata touch are atomic; a `None`
key updates only `gcs_body_ref`/`updated_at`, leaving the column untouched (D2).

## D4 — Replay response shape

Replay returns `detailOf(existing)` — `hopBudgetExhausted`/`searchedWithNoResults` stay `None`
(the original turn's ephemeral signals are not persisted; the outcome badge may not re-show on a
replayed retry — accepted). No `AssistantTelemetry` emit on replay: no turn completed (mirrors
HEL-667 D6's no-turn-no-telemetry guard). One route-level log line for observability.

## D5 — Wire contract, all optional and back-compat

- `ConverseRequest(message, idempotencyKey: Option[String])` — trimmed; blank treated as absent;
  longer than 128 chars rejected 400 (bound junk, mirrors `RequestValidation`'s normalize-first
  posture). spray-json omits `None` on the wire, so keyless clients are byte-identical to today.
- `AssistantConversationResponse` gains `lastIdempotencyKey: Option[String]` populated from the
  record on BOTH `GET /:id` and converse (unlike the HEL-667 signals, this IS a persisted fact — the
  GET presence is exactly what reconciliation needs). `jsonFormat7` → `jsonFormat8`.
- Schemas: `converse-request.schema.json` + `assistant-conversation.schema.json` gain the optional
  fields; `additionalProperties: false` makes forgetting them a validation failure.

## D6 — Client key lifecycle and reconciliation

`MessageComposer` keeps `pendingSend: {key, text} | null` local state (the retry unit is this
composer's preserved input — no other component retries): on submit, reuse `key` iff
`pendingSend.text === trimmed`, else `crypto.randomUUID()`; cleared on success. The `converse` thunk
arg becomes `{id, message, idempotencyKey}`; on `converseRequest` rejection it attempts
`getConversation(id)` — key match → return the fetched detail (normal `converse.fulfilled` flow:
transcript replaces wholesale, composer clears input, no banner; `lastTurnOutcome` derives
`{false,false}` from the absent signals, same as D4's replay); no match or reconciliation-GET
failure → `rejectWithValue(original error)`, preserving today's error UX, with the retry now safe
via D3. New-conversation path: `setSelectedConversationId(created.id)` already flips the prop, so a
retry after a failed first send reuses the existing conversation — no second create (Non-goal
covers the lost-create-response shell).

## Testing

- `AssistantConversationRepositorySpec`: `touchUpdatedAt` persists a `Some` key; a `None` key
  leaves a previously-set value untouched.
- `AssistantConversationServiceSpec`: keyed append records the key; matching-key append no-ops
  (transcript unchanged); keyless append leaves a previously-set key in place.
- `AssistantConversationRoutesSpec`: same-key converse twice → second is 200, transcript unchanged,
  stub `AssistantService` invoked once; key >128 chars → 400; keyless converse unchanged; GET and
  converse responses carry `lastIdempotencyKey`.
- `assistantConversationsSlice.test.ts`: thunk reconciliation (rejection + matching key → fulfilled
  with fetched detail; non-matching → rejected with original message; reconciliation GET failure →
  rejected).
- New `MessageComposer.test.tsx`: key reused on same-text retry, fresh on edited text, cleared
  after success; reconciled send clears input and shows no error.

## Planner Notes (self-approved)

- Residual blob-level race (D3) accepted: window is milliseconds against multi-second Claude calls,
  and the composer's `sending` guard means same-key concurrency only arises from a timeout-retry.
  A per-conversation lock or keyed-request table would be over-engineering for a single-owner chat.
- **Multi-sender reset race — disclosed and accepted out of scope** (skeptic design-gate round-1
  change #1): last-key-only assumes a SINGLE ACTIVE SENDER per conversation at a time, mirroring
  the composer's own single-flight `sending` guard. A second concurrent sender to the same
  conversation — another tab/device (this app ships a PWA), or a future caller of the
  currently-uncalled `/messages` route — landing a *keyed* append between an original send's
  successful append and a same-key retry's append-time check overwrites `last_idempotency_key`
  away from K, un-protecting the retry, which can then produce a real duplicate turn. Window is
  the whole timeout-to-retry interval, not milliseconds. Accepted for this ticket on the same
  footing as the multi-key-table Non-goal: the ticket's scenario is the single composer's own
  preserved-input retry, and closing cross-device concurrent sends needs a keyed-request table —
  deliberately out of scope. The *keyless*-append half of this race is closed outright by D2's
  leave-untouched semantics.
- Same-key timeout-retry race (D3, pre-append interleave) still costs a second full Claude API
  call for the retry even though no duplicate turn results — wasted latency/cost, no AC covers
  it, acknowledged (skeptic round-1 non-blocking note).
- Replay drops the HEL-667 ephemeral badge signals (D4) — cosmetic, documented.
- Create-idempotency out of scope (proposal Non-goals) — no AC covers the empty-shell case.
- No new dependencies, no breaking wire changes, migration is a single nullable-column ADD.
