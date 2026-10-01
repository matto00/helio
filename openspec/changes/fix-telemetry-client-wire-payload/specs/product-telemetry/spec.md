## ADDED Requirements

### Requirement: Client wire payload conforms to the server allow-list
The client SHALL send each product event with only the top-level fields `event`, `properties` and `occurredAt`; client-internal attribution fields such as `userId` SHALL NOT appear on the wire. A cross-boundary test SHALL run the client's real serialized payload through the server's real validator.

#### Scenario: Client batch is accepted
- **WHEN** the client flushes queued events for the signed-in user
- **THEN** `POST /api/events` returns 202 and one `product_events` row per event is stored

#### Scenario: Contract drift fails a test
- **WHEN** the client adds a new top-level field to the wire event
- **THEN** the shared-fixture test fails before merge

### Requirement: Rejected batches are surfaced
When the server rejects a batch with 400 the client SHALL drop that batch and log an error once per page-load containing the server's message; 429 and 5xx SHALL remain retryable.

#### Scenario: 400 is logged once
- **WHEN** the server answers 400 to a batch
- **THEN** the batch is removed from the queue and a single error log with the server message is emitted
