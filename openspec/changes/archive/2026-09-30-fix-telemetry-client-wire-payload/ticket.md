# HEL-1220: Client telemetry batches rejected 400 "unknown field(s): userId": no client product event is ever stored

## Description

`frontend/src/features/telemetry/track.ts` queues `{userId, event, properties, occurredAt}` objects and POSTs them as-is, but `ProductEventRegistry.validateClientEvent` rejects unknown top-level fields, so `POST /api/events` returns 400 `{"message":"unknown field(s): userId"}` for every batch. No client event (first_dashboard_rendered, provenance_opened, firstrun_*) is ever stored; only server-emitted `signup_completed` lands.

Fix: strip `userId` from the wire payload before POSTing (keep it for the queue's identity guard); add a test asserting the exact wire shape against the server's allow-list contract; confirm retry/drop on 400 does not silently discard events a corrected payload would accept.

## Acceptance Criteria (from driver brief)

- Red-first end to end: on main a real `track()` call in a running app yields a 400 and zero client rows in `product_events`; after the fix the same flow stores rows. Verified live against a real backend + DB with each of `first_dashboard_rendered`, `provenance_opened`, `firstrun_file_dropped` present in the table.
- A seam test that fails on drift: the client's real wire payload is run through the server's real validator. Proven failable by mutating the client to add a field.
- 400 handling decided and logged at least once; state whether a 400 drops or quarantines the batch.
- Verify `first_dashboard_rendered` once-per-user flag is not poisoned and users whose batches were dropped are not stuck.
