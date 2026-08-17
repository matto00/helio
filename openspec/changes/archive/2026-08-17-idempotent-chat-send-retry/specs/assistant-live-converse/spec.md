# assistant-live-converse (delta — HEL-698 idempotent-chat-send-retry)

## ADDED Requirements

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
