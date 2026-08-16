# assistant-send-reliability (new — HEL-698 idempotent-chat-send-retry)

## ADDED Requirements

### Requirement: Each logical message send carries one stable idempotency key

The client SHALL generate one idempotency key per logical message: `MessageComposer` reuses the
same key when retrying the same preserved text after a failure, and generates a fresh key when the
text has been edited or a previous send succeeded. The key is sent as `ConverseRequest`'s
`idempotencyKey` on every converse call the composer issues.

#### Scenario: A retry of the same preserved text reuses the key

- **WHEN** a send fails, the composer preserves the typed input, and the user resubmits the
  identical text
- **THEN** the retry's converse request carries the same `idempotencyKey` as the failed attempt

#### Scenario: An edited message is a new logical send

- **WHEN** a send fails and the user edits the preserved text before resubmitting
- **THEN** the new converse request carries a fresh `idempotencyKey`

### Requirement: A send error is reconciled against the server before being displayed as failure

On a converse rejection, the client SHALL re-fetch the conversation (`GET /:id`) and compare the
response's `lastIdempotencyKey` with the key it sent. A match SHALL be treated as a successful
send end-to-end: the transcript (which, by the append's atomicity, already includes Claude's
reply) replaces the active conversation, the composer's input clears, and no error is shown. No
match — or a failed reconciliation fetch — SHALL preserve today's failure UX: error banner shown,
typed input preserved for a (now idempotency-protected) retry.

#### Scenario: A landed send that surfaced an error is displayed as success

- **WHEN** the converse call rejects but the send's turns were durably appended server-side, and
  the reconciliation fetch returns `lastIdempotencyKey` equal to the sent key
- **THEN** the transcript shows the user's message and Claude's reply, the composer's input is
  cleared, and no error banner is displayed

#### Scenario: A genuinely failed send keeps the failure UX

- **WHEN** the converse call rejects and the reconciliation fetch returns a `lastIdempotencyKey`
  different from the sent key (or the fetch itself fails)
- **THEN** the error banner is shown and the typed input remains preserved for retry
