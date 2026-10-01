## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)
- Reviewed HEAD 8c508789936dbdccf4dee621ae97d3b53a653d84 diff vs live base d7a4abd1. No UI changes (design judgment skipped).
- Fix: track.ts toWireEvent is an explicit allow-list pick {event, properties, occurredAt}; send() maps the batch through it. Legacy persisted queue items with userId are covered by a test.
- Seam test: track.wireContract.test.ts drives real track() for every TelemetryEvent variant (exhaustive mapped type), compares to committed fixture; backend ProductEventRegistrySpec runs the same fixture through the real validateClientEvent (Right) and asserts the same events plus userId are Left("unknown field(s): userId") -- this is the red reproduction of the original 400 against the real validator.
- Re-ran: jest src/features/telemetry 23/23 pass; sbt testOnly *ProductEventRegistrySpec 14/14 pass.
- Mutation (my own): re-adding userId to toWireEvent -> 4 tests failed (wireContract + track.test); reverted with git checkout; tree clean (only untracked evaluation-1.md).
- 400 handling: drop + one console.error per page-load with status and server message; 401 silent drop; 429/5xx retry; tested.
- first_dashboard_rendered flag: marked delivered only on success (firstDashboardFlag.ts); pending set is in-memory so a 400-dropped event is re-claimable after reload; test covers it. Users not stuck.
- Evaluator's live run (fresh user, rows for first_dashboard_rendered, provenance_opened, firstrun_file_dropped stored, cleanup by exact id) taken as a claim; consistent with code and tests.

### Verdict: CONFIRM

### Non-blocking notes
- Live red-on-main (400 + zero rows on unfixed main) was not re-executed by the evaluator or me; the backend negative test against the real validator and the mutation proof stand in for it. Not blocking.
- Within one page-load a 400-dropped first_dashboard_rendered is not re-queued until reload (documented, accepted).
