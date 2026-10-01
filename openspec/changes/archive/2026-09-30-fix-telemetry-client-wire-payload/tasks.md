## 1. Red first

- [x] 1.1 On a base-branch checkout (or before code changes) run a real backend+DB and the app: trigger `track()` for `first_dashboard_rendered`, `provenance_opened`, `firstrun_file_dropped`; record the 400 and zero client rows in `product_events` (save transcript/output as evidence in the report).

## 2. Fix

- [x] 2.1 Add exported `toWireEvent` to `track.ts` (pick event/properties/occurredAt) and use it in `send()`; verify `npm test -- --testPathPatterns=track` passes.
- [x] 2.2 On 400, drop the batch and `console.error` once per page-load with status + server message; 429/5xx retry and 401 silent drop unchanged; verify with unit tests per status.
- [x] 2.3 Unit test: a legacy persisted queue item containing `userId` is flushed without `userId`; and `first_dashboard_rendered` flag is NOT set after a 400 and is re-claimable after reload.

## 3. Seam test

- [x] 3.1 Frontend test drives real `track()` for every TelemetryEvent variant, captures the fetch body, compares to `backend/src/test/resources/telemetry/client-wire-batch.json` (UPDATE_TELEMETRY_FIXTURE=1 rewrites); verify passes.
- [x] 3.2 `ProductEventRegistrySpec` reads the fixture, asserts every event is `Right` via `validateClientEvent`, and that the same event plus `userId` is `Left("unknown field(s): userId")`; verify with `sbt "testOnly *ProductEventRegistrySpec"`.
- [x] 3.3 Mutation proof: add a field to the client wire mapper and show the seam test goes red; revert; record in report.

## 4. Live verification

- [x] 4.1 After the fix, repeat 1.1 against a real backend+DB: rows for all three events appear in `product_events`; record ids of any test users/events created and delete them by exact id before finishing.
- [x] 4.2 Run lint, typecheck, format:check, jest, and the backend telemetry specs; keep `files-modified.md` complete.

## 5. Skeptic design-gate notes (apply)

- [x] 5.1 Seam test coverage of every TelemetryEvent variant is compile-time exhaustive (e.g. a `Record<TelemetryEvent["event"], ...>`), so a new variant cannot be omitted.
- [x] 5.2 Fixture `occurredAt` is deterministic (fake timers / fixed Date).
- [x] 5.3 The frontend seam test FAILS (not skips) when the fixture is missing and UPDATE_TELEMETRY_FIXTURE is unset.
- [x] 5.4 The log-once flag is reset by the test-reset helper.

## Standing Constraints

- [C1] 3 workers max, nice -n 19; Bash timeout 600000 for hooks/sbt/jest; screenshots never at repo root; no migration (V114 next if needed, tell driver first); do not delete under ~/.helio/uploads; clean dev-DB test users/events by exact id
