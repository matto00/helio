## Context

`track()` queues `QueuedEvent {userId, event, properties, occurredAt}` and `send()` stringifies the queued objects directly. `validateClientEvent` accepts only `event`, `properties`, `occurredAt` at top level. The `first_dashboard_rendered` once-per-user flag is set only on a "sent" outcome, and the in-memory `pending` set is cleared on reload, so a dropped batch does not poison it; after reload the event is re-emitted. Within a single page-load a dropped event is not re-queued (accepted: best-effort telemetry).

## Goals / Non-Goals

**Goals:** correct wire shape; a cross-language seam test that fails on drift in either direction; visible handling of 400.
**Non-Goals:** changing the server contract, retry/backoff redesign, quarantine storage.

## Decisions

1. **Explicit `toWireEvent(e)` mapper (exported)** picking `event`, `properties`, `occurredAt` rather than `delete userId`. An allow-list pick means a future queue-only field cannot leak onto the wire. Alternative (omit-by-destructure of userId) rejected: new internal fields would leak again.
2. **Shared fixture seam test.** The frontend test drives the real `track()` for every `TelemetryEvent` variant with `fetch` mocked, captures the exact JSON body, and compares it to `backend/src/test/resources/telemetry/client-wire-batch.json` (a committed fixture; the test regenerates and fails when different, with an env flag `UPDATE_TELEMETRY_FIXTURE=1` to rewrite it). `ProductEventRegistrySpec` reads that same file and asserts every event validates `Right`. Adding a client field fails the frontend comparison (and, once the fixture is regenerated, the backend spec). A backend negative test asserts the old shape (with `userId`) is still rejected, so the fixture can't be silently satisfied by loosening the validator. The test must be shown failable by mutation.
3. **400 handling: drop, loudly.** A 400 means contract drift; resending identical bytes can never succeed, and quarantining indefinitely would grow the queue past MAX_QUEUE and block healthy events. The batch is dropped and `console.error` is emitted once per page-load including status and the server's `message`. 401 stays a silent drop (logged out). 429/5xx stay retry.
4. **Legacy persisted queue** items still contain `userId`; the mapper strips them at send, so they flush successfully after upgrade.

## Risks / Trade-offs

- [One bad event drops its batch of up to 25] → the fixture test makes a bad client event un-mergeable; accepted.
- [Fixture path coupling between frontend test and backend resources] → the frontend test fails clearly if the file is missing.
