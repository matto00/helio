## Standing Constraints

- [C1] No test-only members in production code (the reason `thinAndPurge` moves); test seams live in test sources.
- [C2] Deterministic tests use Promise/clock seams: no real sleeps, no real-time `eventually` polling.
- [C3] Measurements run on a scratch DB in `hel1477-*` containers only, with `nice -n 19`, MemAvailable >= 15 GB, and
  teardown by exact name. Never touch `backend/.env`, the dev DB or prod.
- [C4] No retention default changes (batch rows/outputs/count, intervals); any change is a flagged product call.
- [C5] New specs use `VerifiedEmbeddedPostgres.start`. Every sbt run shows `[hel1468-guard]`. No inline FQNs. At most two
  `sbt testFull` runs machine-wide.
- [C6] Red first: each behavioural test is recorded failing on the unfixed code before the fix.
- [C7] The in-flight guard is released only after the WHOLE pass (history and payload) and after the nextDue rewrite. Tests observe nextDue through behaviour; no test-only accessor.

### Backend

## 1. Premise measurement (main, before any code change)

- [x] 1.1 Add the scratch harness (`hel1477-*` container script/driver mode for tick latency, refusal guard) and record the refusal test
- [x] 1.2 Seed S4 (and S2); on main measure tick wall time with retention due, the idle tick, and (AC metric) the fire delay of a schedule that becomes due during a pass under an actor-like tick-then-interval loop; desktop + prod-io-base; log under evidence/
- [x] 1.3 If the tick does not await the pass on main, stop and escalate (design Planner Notes)

## 2. Detach and guard

- [x] 2.1 In-flight guard in `OutputHistoryRetentionService.purgeIfDue` (CAS, released on every outcome; a busy tick does not touch `nextDue`); verify with 3.1
- [x] 2.2 `PipelineSchedulerService.tick` starts the history work detached (still `Future.delegate` + `recover` + log) and excludes it from the tick result; verify with 3.2
- [x] 2.3 Move `thinAndPurge` into a test-support helper on `thinPass`; delete it from `OutputHistoryRepository`; update all call sites; verify `grep -rn thinAndPurge backend/src/main/scala` is empty; do NOT edit V120 (applied migration checksum)
- [x] 2.4 Update the CLAUDE.md `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` row (and any other row/comment saying a pass stalls the tick) to the new behaviour; verify by grep

### Tests

## 3. Tests (red first)

- [x] 3.1 Service spec: a Promise-held pass; advance the clock past purgeInterval; a second `purgeIfDue` returns `None` and leaves nextDue unchanged; release on success, failure and a synchronous throw; record the red on unfixed code
- [x] 3.1a Service spec: a not-due call, then advance the clock past due, then the pass runs (guard not wedged by the not-due exit)
- [x] 3.2 Scheduler spec: with a never-completing retention pass, `tick()` completes and the due schedule fires; record the red (the tick hangs or times out) on unfixed code
- [x] 3.3 Migrate the maintenance-hook failure specs to observe the detached pass via a capturing service subclass (no sleeps)
- [x] 3.4 Strengthen the row-limit split test to exact batch composition; record a mutation (row limit ignored) failing it
- [x] 3.5 Run the affected specs plus `sbt testFull` (niced, MemAvailable check) with `[hel1468-guard]` in the output; frontend untouched

## 4. Measurements and docs

- [x] 4.1 Re-measure on the branch (same profiles/seeds): tick wall time; the during-pass fire delay against the absolute bound (tick interval + the tick's own work); the tick during an in-flight pass; lock-held skips. Write measurements.md
- [x] 4.2 Edit the archived HEL-1435 measurements.md: the `SET LOCAL work_mem` sentence; cite or drop "first clone ... colder run"
- [x] 4.3 Tear down `hel1477-*` containers and volumes by exact name; record the teardown log
