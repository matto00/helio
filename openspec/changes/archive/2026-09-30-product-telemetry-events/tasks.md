## Standing Constraints

- [C1] Red-first on every acceptance criterion; keep `files-modified.md` complete as you go.
- [C2] Retention purge and rollup tests inject time; never a wall-clock wait.
- [C3] Run V113 as a non-BYPASSRLS role in an isolated scratch DB before touching the shared dev DB; clean any dev-DB residue by exact id.
- [C4] Do not edit `scripts/concertino/**`.

## 1. Migration and persistence

- [x] 1.1 Write V113 (product_events with CHECK, FK cascade, dedupe partial unique index, RLS owner policy, rollup tables, rollup state) and include explicit GRANTs to helio_privileged, confirm whether test harness table lists need the new tables, and verify it applies in a scratch DB as a non-BYPASSRLS LOGIN role that can SET ROLE helio_privileged, exercising rollup and purge on the privileged role, and Flyway validates
- [x] 1.2 Repository (user-context insert with ON CONFLICT DO NOTHING; system-context rollup/purge) and verify a non-superuser cross-user isolation test is red before and green after
- [x] 1.3 Verify FK cascade removes a deleted user's events (test)

## 2. Ingestion

- [x] 2.1 Event/property registry and validator; red-first tests for unknown event, unknown property, wrong type, forged signup_completed, oversize batch; verify a Scala-vs-CHECK allow-list equality test
- [x] 2.2 Server-side dedupe via ON CONFLICT matching the partial index predicate: two first_dashboard_rendered posts yield one row and both 2xx. POST /api/events route wired into ApiRoutes with its own rate limiter; verify 400/401/429/2xx route tests
- [x] 2.3 Record signup_completed in AuthService.register AFTER userRepo.insert commits, in withUserContext(newUser.id), best-effort via recover; verify registration test and failure-does-not-break test

## 3. Rollup and retention

- [x] 3.1 rollupDay (idempotent), TTFD median/p90/histogram, DAU/WAU, property counts; verify fixture test with hand-computed values (percentile_cont median/p90, histogram, WAU), pre-ship-user exclusion, negative-diff exclusion, template `other` bucketing, advisory-lock/upsert idempotence, and a rerun-idempotence test
- [x] 3.2 purge with injected clock and high-water-mark guard, exemption of signup_completed/first_dashboard_rendered, throttle via product_rollup_state; wire rollup+purge into the scheduler tick; verify 91-day and unrolled-day tests, a 91-day-old signup_completed/first_dashboard_rendered row SURVIVES purge, an old day's WAU is not overwritten from partial data, and a final rollupDay runs before advancing rolled_through
- [x] 3.3 Document PRODUCT_EVENTS_RATE_LIMIT_PER_WINDOW and PRODUCT_EVENTS_RETENTION_DAYS in CLAUDE.md env table and verify by grep

## 4. Frontend

- [x] 4.1 track() helper with offline batch, keepalive flush, swallow + warn once; verify jest tests (unauthenticated/public no-emit, non-blocking, failure silent, retry offline)
- [x] 4.2 Fill onProvenanceOpened to track provenance_opened; update ProvenanceTrigger tests
- [x] 4.3 Emit first_dashboard_rendered on first non-empty output panel render with localStorage guard; verify jest test incl. empty-panel negative
- [x] 4.4 Run lint, typecheck, format:check, jest, sbt test; verify green
