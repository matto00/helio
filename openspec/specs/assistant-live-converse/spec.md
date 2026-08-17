# assistant-live-converse Specification

## Purpose
The live backend endpoint that actually invokes `AssistantService.converse` and persists the
resulting turns via `AssistantConversationService` — the first real wiring of the assistant's
conversational loop to a route a user can reach, degrading cleanly to `503` when the assistant
itself is unavailable and never persisting anything on a failed Claude/transport call.
## Requirements
### Requirement: A live endpoint sends a message and persists the resulting turns
The system SHALL expose `POST /api/assistant-conversations/:id/converse`, accepting `{message:
string}`, that calls `AssistantService.converse` against the conversation's existing transcript,
persists the resulting new turns via `AssistantConversationService.appendTurn`, and returns the
refreshed conversation detail (including the updated transcript).

#### Scenario: A sent message is persisted and returned in the response
- **WHEN** an authenticated user posts a message to their own conversation's `/converse` endpoint
- **THEN** the response's transcript includes the user's new message and Claude's response, and a
  subsequent `GET` for the same conversation returns the identical, already-persisted transcript

### Requirement: A real Claude/transport failure returns an error and persists nothing
`POST /:id/converse` SHALL return a mapped error status (never a `200`) and SHALL NOT call
`appendTurn` when the underlying `AssistantService.converse` call fails, so a real API failure
never silently discards the user's message nor gets persisted into the transcript as a fabricated
response.

#### Scenario: A failed converse call leaves the transcript unchanged
- **WHEN** `AssistantService.converse` resolves to `Left(ClaudeError)` for a given `/converse`
  request
- **THEN** the response is a non-`200` error status, and a subsequent `GET` for the same
  conversation shows the transcript exactly as it was before the failed request

### Requirement: The endpoint degrades to a clean 503 when the assistant is unavailable
`POST /:id/converse` SHALL respond `503` when `AssistantService` is unavailable (e.g. no
`ANTHROPIC_API_KEY` configured), independent of whether the rest of the `assistant-conversations`
route family (list/create/get/append/pin) is available.

#### Scenario: A missing Claude configuration degrades only the converse route
- **WHEN** `AssistantService` is unavailable but conversation persistence is otherwise configured
- **THEN** `POST /:id/converse` responds `503` while `GET /api/assistant-conversations` continues
  to work normally

### Requirement: Only the conversation's owner can converse with it
`POST /:id/converse` SHALL enforce the same ownership scoping every other
`assistant-conversations` endpoint already enforces — a caller cannot converse with, or persist
turns into, a conversation they do not own.

#### Scenario: A second user cannot converse with the first user's conversation
- **WHEN** a user posts to `/converse` for a conversation id they do not own
- **THEN** the response is a not-found result, not the conversation's content, and no turns are
  persisted

### Requirement: The converse response surfaces hop-cap and no-results turn outcomes
`AssistantConversationResponse` SHALL carry two additional optional fields, `hopBudgetExhausted:
Option[Boolean]` and `searchedWithNoResults: Option[Boolean]`, populated from
`AssistantTurnResult`'s identically-named fields only on a `POST /:id/converse` response. `GET
/:id` SHALL leave both fields absent (`None`) — these are ephemeral signals describing the turn
that just completed, not persisted facts about the conversation as a whole.

#### Scenario: A hop-cap-exhausted converse call surfaces the signal
- **WHEN** `AssistantService.converse` resolves to a `Right(result)` with `result.hopBudgetExhausted
  == true`
- **THEN** the `POST /:id/converse` response's `hopBudgetExhausted` field is `Some(true)`

#### Scenario: A zero-result-search converse call surfaces the signal
- **WHEN** `AssistantService.converse` resolves to a `Right(result)` with
  `result.searchedWithNoResults == true`
- **THEN** the `POST /:id/converse` response's `searchedWithNoResults` field is `Some(true)`

#### Scenario: GET never carries either signal
- **WHEN** a client calls `GET /:id` for any conversation, regardless of its transcript's content
- **THEN** the response's `hopBudgetExhausted` and `searchedWithNoResults` fields are both absent

### Requirement: A converse replay with the last-applied idempotency key is a no-op

`ConverseRequest` SHALL accept an optional client-generated `idempotencyKey` (trimmed; blank
treated as absent; longer than 128 characters rejected with a `400`). The system SHALL persist the
key of the most recent KEYED append on the conversation row (`last_idempotency_key`); an append
carrying no key SHALL leave the column unchanged, so an unrelated keyless append can never
un-protect an outstanding keyed retry. The system SHALL treat a converse whose key equals the
last-applied key as a replay: return the current conversation detail with a `200`, without
invoking `AssistantService.converse` and without appending any turns. The replay check SHALL run
both at route entry and again at append time against a freshly-read record, so a retry racing a
still-in-flight original with the same key does not produce a duplicate append. A keyless converse
SHALL behave exactly as before this change.

#### Scenario: Retrying an already-landed send does not duplicate the turn

- **WHEN** a converse with key K completes its append, and a second converse for the same
  conversation arrives carrying the same key K
- **THEN** the second responds `200` with the current conversation detail, the transcript is
  byte-identical to before the second call, and the underlying `AssistantService.converse` is not
  invoked for it

#### Scenario: Concurrent duplicate with the same key appends only once

- **WHEN** two converse requests with the same key K are in flight together and one completes its
  append first
- **THEN** the other's append observes the recorded key K and applies nothing

#### Scenario: An over-long key is rejected

- **WHEN** a converse request carries an `idempotencyKey` longer than 128 characters
- **THEN** the response is a `400` and nothing is persisted

#### Scenario: A keyless append does not disturb the recorded key

- **WHEN** a converse with key K completes its append and a subsequent append for the same
  conversation carries no key
- **THEN** the conversation row's `last_idempotency_key` remains K, and a converse retry carrying
  key K is still treated as a replay

### Requirement: The response exposes the last-applied idempotency key

`AssistantConversationResponse` SHALL carry an optional `lastIdempotencyKey`, populated from the
persisted row on BOTH `GET /:id` and `POST /:id/converse` responses (unlike the ephemeral
turn-outcome signals, this is a persisted fact about the conversation), and absent until a keyed
append has occurred.

#### Scenario: GET reveals whether a keyed send landed

- **WHEN** a converse with key K completes its append and a client subsequently calls `GET /:id`
- **THEN** the response's `lastIdempotencyKey` is K

